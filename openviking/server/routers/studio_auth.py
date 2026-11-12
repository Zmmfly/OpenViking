# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0
"""Self-hosted Studio login and personal credential management."""

import asyncio
import hashlib
import hmac
import secrets
import time
from urllib.parse import urlencode

import httpx
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from openviking.core.identifiers import validate_account_id, validate_user_id
from openviking.server.auth import get_request_context, is_personal_api_key_auth
from openviking.server.dependencies import get_service
from openviking.server.identity import RequestContext, Role
from openviking.server.models import Response
from openviking.server.studio_auth import (
    SESSION_COOKIE,
    browser_login_enabled,
    check_browser_origin,
    read_state,
    resolve_browser_session,
    session_response,
    sign_state,
)
from openviking_cli.exceptions import (
    FailedPreconditionError,
    InvalidArgumentError,
    PermissionDeniedError,
    UnauthenticatedError,
)
from openviking_cli.session.user_id import UserIdentifier

router = APIRouter(prefix="/api/v1/auth", tags=["browser-auth"])
keys_router = APIRouter(prefix="/api/v1/me", tags=["personal-api-keys"])
_DUMMY_HASH = PasswordHasher().hash("unusable-dummy-password-for-timing")


class LoginRequest(BaseModel):
    account_id: str = Field(default="default", min_length=1, max_length=255)
    user_id: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=128, repr=False)


class BootstrapRequest(LoginRequest):
    password: str = Field(min_length=12, max_length=128, repr=False)
    root_key: str = Field(min_length=1, repr=False)


class PasswordRequest(BaseModel):
    current_password: str = Field(default="", max_length=128, repr=False)
    password: str = Field(min_length=12, max_length=128, repr=False)


class CreateKeyRequest(BaseModel):
    label: str = Field(default="", max_length=128)


def _manager(request: Request):
    if not browser_login_enabled(request):
        raise FailedPreconditionError(
            "Browser login requires api_key or oidc mode and server.root_api_key"
        )
    return request.app.state.api_key_manager


def _rate_limit(request: Request) -> None:
    """Bound password-verification work and online guessing per source address."""
    now = time.monotonic()
    attempts = getattr(request.app.state, "studio_login_attempts", {})
    attempts = {key: value for key, value in attempts.items() if value[1] > now}
    key = request.client.host if request.client else "unknown"
    count, deadline = attempts.get(key, (0, now + 60))
    if count >= 15 or len(attempts) >= 4096:
        from fastapi import HTTPException

        raise HTTPException(
            429, "Too many login attempts; try again later", headers={"Retry-After": "60"}
        )
    attempts[key] = (count + 1, deadline)
    request.app.state.studio_login_attempts = attempts


async def _verify_password(encoded: str, password: str) -> bool:
    try:
        return await asyncio.to_thread(PasswordHasher().verify, encoded or _DUMMY_HASH, password)
    except VerificationError:
        return False


@router.get("/session")
async def get_session(request: Request):
    enabled = browser_login_enabled(request)
    result = {
        "enabled": enabled,
        "authenticated": False,
        "oidc": False,
        "auth_mode": request.app.state.config.get_effective_auth_mode(),
    }
    if enabled:
        result["oidc"] = bool(
            request.app.state.config.oidc and request.app.state.config.oidc.client_id
        )
        try:
            identity = await resolve_browser_session(request)
            result.update(
                authenticated=True,
                account_id=identity.account_id,
                user_id=identity.user_id,
                role=str(identity.role),
            )
        except UnauthenticatedError:
            pass
    return JSONResponse({"status": "ok", "result": result}, headers={"Cache-Control": "no-store"})


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    manager = _manager(request)
    check_browser_origin(request)
    _rate_limit(request)
    info = await manager.get_login_info(body.account_id, body.user_id)
    if not await _verify_password(info.get("password_hash", ""), body.password) or not info.get(
        "password_hash"
    ):
        raise UnauthenticatedError("Invalid account, username or password")
    return await session_response(
        request, body.account_id, body.user_id, expected_version=info.get("session_version", "")
    )


@router.post("/bootstrap")
async def bootstrap(body: BootstrapRequest, request: Request):
    manager = _manager(request)
    check_browser_origin(request)
    _rate_limit(request)
    if not hmac.compare_digest(body.root_key, request.app.state.config.root_api_key):
        raise UnauthenticatedError("Invalid setup credential")
    manager.require_writable()
    user = (
        await manager.get_user_membership(body.account_id, body.user_id)
        if await manager.get_account(body.account_id)
        else None
    )
    if user and (user["role"] != Role.ADMIN or user.get("disabled")):
        raise InvalidArgumentError("Setup requires an active administrator identity")
    if not await manager.get_account(body.account_id):
        await manager.create_account(body.account_id, body.user_id)
    elif not user:
        await manager.register_user(body.account_id, body.user_id, Role.ADMIN)
    await manager.set_login_password(
        body.account_id, body.user_id, body.password, server_admin=True, only_if_unset=True
    )
    service = get_service()
    await service.initialize_user_directories(
        RequestContext(user=UserIdentifier(body.account_id, body.user_id), role=Role.ADMIN)
    )
    return await session_response(request, body.account_id, body.user_id)


@router.post("/logout")
async def logout(request: Request):
    check_browser_origin(request)
    identity = await resolve_browser_session(request)
    await _manager(request).invalidate_sessions(identity.account_id, identity.user_id)
    response = JSONResponse({"status": "ok"})
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    return response


@router.put("/password")
async def change_password(body: PasswordRequest, request: Request):
    identity = await resolve_browser_session(request)
    manager = _manager(request)
    _rate_limit(request)
    info = await manager.get_login_info(identity.account_id, identity.user_id)
    if not info.get("password_hash") or not await _verify_password(
        info["password_hash"], body.current_password
    ):
        raise UnauthenticatedError("Current password is incorrect")
    await manager.set_login_password(
        identity.account_id,
        identity.user_id,
        body.password,
        expected_session_version=info.get("session_version", ""),
    )
    return await session_response(request, identity.account_id, identity.user_id)


def _personal_manager(request: Request, ctx: RequestContext):
    if not ctx.from_session and not is_personal_api_key_auth(request, ctx):
        raise PermissionDeniedError(
            "Personal key management requires browser login or a personal API key"
        )
    if ctx.role not in {Role.ROOT, Role.ADMIN, Role.USER} or (
        ctx.role == Role.ROOT and not ctx.from_session
    ):
        raise PermissionDeniedError("A registered user identity is required")
    return request.app.state.api_key_manager


@keys_router.get("/api-keys")
async def list_keys(request: Request, ctx: RequestContext = Depends(get_request_context)):
    return Response(
        status="ok",
        result=await _personal_manager(request, ctx).list_api_keys(
            ctx.account_id, ctx.user.user_id
        ),
    )


@keys_router.post("/api-keys")
async def create_key(
    body: CreateKeyRequest, request: Request, ctx: RequestContext = Depends(get_request_context)
):
    result = await _personal_manager(request, ctx).create_api_key(
        ctx.account_id,
        ctx.user.user_id,
        body.label,
        expected_api_key=None if ctx.from_session else ctx.api_key,
    )
    return JSONResponse({"status": "ok", "result": result}, headers={"Cache-Control": "no-store"})


@keys_router.post("/api-keys/{key_id}/rotate")
async def rotate_key(
    key_id: str, request: Request, ctx: RequestContext = Depends(get_request_context)
):
    result = await _personal_manager(request, ctx).rotate_api_key(
        ctx.account_id,
        ctx.user.user_id,
        key_id,
        expected_api_key=None if ctx.from_session else ctx.api_key,
    )
    return JSONResponse({"status": "ok", "result": result}, headers={"Cache-Control": "no-store"})


@keys_router.delete("/api-keys/{key_id}")
async def delete_key(
    key_id: str, request: Request, ctx: RequestContext = Depends(get_request_context)
):
    await _personal_manager(request, ctx).delete_api_key(
        ctx.account_id,
        ctx.user.user_id,
        key_id,
        expected_api_key=None if ctx.from_session else ctx.api_key,
    )
    return Response(status="ok", result={"deleted": True})


async def _oidc_metadata(request: Request):
    _manager(request)
    config = request.app.state.config.oidc
    if config is None or not config.client_id:
        raise FailedPreconditionError("OIDC login requires issuer and client_id")
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(config.issuer.rstrip("/") + "/.well-known/openid-configuration")
        response.raise_for_status()
        metadata = response.json()
    if metadata.get("issuer") != config.issuer:
        raise FailedPreconditionError("OIDC discovery issuer does not match configuration")
    return config, metadata


@router.get("/oidc/login")
async def oidc_login(request: Request):
    import base64

    config, metadata = await _oidc_metadata(request)
    verifier = secrets.token_urlsafe(48)
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    callback = str(request.url_for("oidc_callback"))
    endpoint = metadata.get("authorization_endpoint", "")
    if not endpoint.startswith(("https://", "http://")):
        raise FailedPreconditionError("OIDC authorization endpoint is unavailable")
    response = RedirectResponse(
        endpoint
        + ("&" if "?" in endpoint else "?")
        + urlencode(
            {
                "client_id": config.client_id,
                "response_type": "code",
                "scope": "openid profile",
                "redirect_uri": callback,
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        ),
        status_code=302,
    )
    response.set_cookie(
        "ov_studio_oidc",
        sign_state(
            request,
            {
                "kind": "oidc",
                "state": state,
                "nonce": nonce,
                "verifier": verifier,
                "exp": int(time.time()) + 600,
            },
        ),
        max_age=600,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/api/v1/auth/oidc",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/oidc/callback")
async def oidc_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    from openviking.server.auth.identity_mapping import IdentityMapper
    from openviking.server.auth.plugins.oidc import OIDCAuthPlugin, _check_jwt_available

    _manager(request)
    saved = read_state(request, request.cookies.get("ov_studio_oidc", ""))
    if (
        error
        or not code
        or saved.get("kind") != "oidc"
        or not hmac.compare_digest(str(saved.get("state", "")), state)
    ):
        raise UnauthenticatedError("OIDC login was rejected or its state is invalid")
    config, metadata = await _oidc_metadata(request)
    endpoint = metadata.get("token_endpoint", "")
    if not endpoint.startswith(("https://", "http://")) or not _check_jwt_available():
        raise FailedPreconditionError("OIDC token endpoint or JWT support is unavailable")
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": config.client_id,
        "redirect_uri": str(request.url_for("oidc_callback")),
        "code_verifier": saved["verifier"],
    }
    client_auth = None
    if config.client_secret:
        methods = metadata.get("token_endpoint_auth_methods_supported", ["client_secret_basic"])
        if "client_secret_basic" in methods:
            client_auth = httpx.BasicAuth(config.client_id, config.client_secret)
        elif "client_secret_post" in methods:
            data["client_secret"] = config.client_secret
        else:
            raise FailedPreconditionError(
                "OIDC provider does not support client secret authentication"
            )
    async with httpx.AsyncClient(timeout=10) as client:
        token_response = await client.post(endpoint, data=data, auth=client_auth)
        if token_response.is_error:
            raise UnauthenticatedError("OIDC authorization code exchange failed")
        token = token_response.json().get("id_token")
    if not isinstance(token, str):
        raise UnauthenticatedError("OIDC provider did not return an ID token")
    validator = OIDCAuthPlugin()
    validator._config = config
    validator._effective_audience = config.client_id
    claims = await validator._validate_token(token)
    if any(field not in claims for field in ("iss", "sub", "aud", "exp", "iat")):
        raise UnauthenticatedError("OIDC ID token is missing required claims")
    if not hmac.compare_digest(str(claims.get("nonce", "")), saved["nonce"]):
        raise UnauthenticatedError("OIDC token nonce does not match login")
    mapper = IdentityMapper(config.identity)
    try:
        account_id, user_id = mapper.map_account_id(claims), mapper.map_user_id(claims)
        if validate_account_id(account_id) or validate_user_id(user_id):
            raise ValueError("Invalid mapped identity")
    except ValueError:
        raise UnauthenticatedError("OIDC identity mapping failed") from None
    manager = request.app.state.api_key_manager
    user = await manager.get_user_membership(account_id, user_id)
    if not user or user.get("disabled") or await manager.get_deletion(account_id, user_id):
        raise UnauthenticatedError(
            "OIDC user has not been added by an administrator or is disabled"
        )
    response = await session_response(request, account_id, user_id)
    response.status_code = 302
    response.headers["Location"] = "/studio/"
    response.delete_cookie("ov_studio_oidc", path="/api/v1/auth/oidc")
    return response
