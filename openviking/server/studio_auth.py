# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0
"""Browser sessions, separate from API credentials used by SDKs.

Cookies contain a signed identity and a revocable per-user session version,
never a password or API key. Every request reads current membership and login
state so disabling a user, resetting a password or logout revokes sessions.
"""

import base64
import hashlib
import hmac
import json
import time
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse

from openviking.server.identity import ResolvedIdentity, Role
from openviking_cli.exceptions import PermissionDeniedError, UnauthenticatedError

SESSION_COOKIE = "ov_studio_session"
FORWARD_PREFIX = "ovsf_"


class BrowserSessionCacheMiddleware:
    """Keep authenticated API responses out of shared caches without buffering streams."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        private = (
            scope["type"] == "http"
            and (
                scope.get("path", "").startswith(("/api/", "/bot/", "/mcp"))
                or scope.get("path") == "/health"
            )
            and any(
                name.lower() == b"cookie" and SESSION_COOKIE.encode() + b"=" in value
                for name, value in scope.get("headers", [])
            )
        )
        if not private:
            return await self.app(scope, receive, send)

        async def send_private(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        (name, value)
                        for name, value in message.get("headers", [])
                        if name.lower() != b"cache-control"
                    ]
                    + [(b"cache-control", b"no-store")],
                }
            await send(message)

        await self.app(scope, receive, send_private)


def browser_login_enabled(request: Request) -> bool:
    config = request.app.state.config
    return bool(
        config.studio_login_enabled
        and config.root_api_key
        and config.get_effective_auth_mode() in {"api_key", "oidc"}
        and getattr(request.app.state, "api_key_manager", None) is not None
    )


def check_browser_origin(request: Request) -> None:
    """Cookie-authenticated writes must originate from the hosted Studio."""
    origin = request.headers.get("origin")
    expected = urlsplit(str(request.base_url))
    if origin:
        supplied = urlsplit(origin)
        if (supplied.scheme, supplied.netloc) != (expected.scheme, expected.netloc):
            raise PermissionDeniedError("Cross-origin browser request rejected")
    elif (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.headers.get("X-OpenViking-CSRF") != "1"
    ):
        raise PermissionDeniedError("Missing browser request verification")


def _signing_secret(root_key: str) -> bytes:
    return hashlib.sha256(("openviking-studio-v1\0" + root_key).encode()).digest()


def sign_state(request: Request, payload: dict) -> str:
    data = (
        base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode())
        .decode()
        .rstrip("=")
    )
    signature = hmac.new(
        _signing_secret(request.app.state.config.root_api_key), data.encode(), hashlib.sha256
    ).hexdigest()
    return f"{data}.{signature}"


def read_state(request: Request, token: str) -> dict:
    return _read_signed_state(request.app.state.config.root_api_key, token)


def _read_signed_state(root_key: str, token: str) -> dict:
    try:
        data, signature = token.split(".")
        expected = hmac.new(_signing_secret(root_key), data.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise ValueError()
        payload = json.loads(base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)))
        if not isinstance(payload, dict) or payload.get("exp", 0) <= time.time():
            raise ValueError()
        return payload
    except (ValueError, TypeError, UnicodeError):
        raise UnauthenticatedError("Invalid or expired browser session") from None


def browser_forward_credential(request: Request, identity: ResolvedIdentity) -> str:
    """Forward session-limited user authorization, never the browser cookie or ROOT."""
    session = read_state(request, request.cookies[SESSION_COOKIE])
    return FORWARD_PREFIX + sign_state(
        request,
        {
            "kind": "forward",
            "account": identity.account_id,
            "user": identity.user_id,
            "role": Role.ADMIN if identity.role == Role.ROOT else str(identity.role),
            "version": session["version"],
            "exp": session["exp"],
        },
    )


async def resolve_forward_credential(manager, root_key: str, token: str) -> ResolvedIdentity:
    payload = _read_signed_state(root_key, token[len(FORWARD_PREFIX) :])
    if payload.get("kind") != "forward" or payload.get("role") not in {Role.ADMIN, Role.USER}:
        raise UnauthenticatedError("Invalid browser forwarding authorization")
    account_id, user_id = payload.get("account"), payload.get("user")
    if not isinstance(account_id, str) or not isinstance(user_id, str):
        raise UnauthenticatedError("Invalid browser forwarding identity")
    login = await manager.get_login_info(account_id, user_id)
    version = login.get("session_version", "")
    if not version or not hmac.compare_digest(version, str(payload.get("version", ""))):
        raise UnauthenticatedError("Browser forwarding authorization has been revoked")
    user = await manager.get_user_for_auth(account_id, user_id)
    role = Role.parse(payload["role"])
    if (
        not user
        or user.get("role") not in {Role.ADMIN, Role.USER}
        or user.get("disabled")
        or await manager.get_deletion(account_id, user_id)
        or not Role.parse(user["role"]).allows_token_role(role)
    ):
        raise UnauthenticatedError("Browser forwarding identity is unavailable")
    return ResolvedIdentity(
        role=role,
        account_id=account_id,
        user_id=user_id,
        # Forwarded service calls carry delegated authority. Existing OAuth
        # guards prevent them minting personal keys or another authorization.
        from_oauth=True,
        group_ids=await manager.get_user_group_ids(account_id, user_id),
    )


async def resolve_browser_session(request: Request) -> ResolvedIdentity:
    if not browser_login_enabled(request):
        raise UnauthenticatedError("Browser login is not enabled")
    check_browser_origin(request)
    payload = read_state(request, request.cookies.get(SESSION_COOKIE, ""))
    if payload.get("kind") != "session":
        raise UnauthenticatedError("Invalid browser session")
    account_id, user_id = payload.get("account"), payload.get("user")
    if not isinstance(account_id, str) or not isinstance(user_id, str):
        raise UnauthenticatedError("Invalid browser identity")
    manager = request.app.state.api_key_manager
    login = await manager.get_login_info(account_id, user_id)
    version = login.get("session_version")
    if not version or not hmac.compare_digest(version, str(payload.get("version", ""))):
        raise UnauthenticatedError("Browser session has been revoked")
    user = await manager.get_user_membership(account_id, user_id)
    if (
        not user
        or user.get("role") not in {Role.ADMIN, Role.USER}
        or user.get("disabled")
        or await manager.get_deletion(account_id, user_id)
    ):
        raise UnauthenticatedError("User is unavailable")
    role = Role.parse(user["role"])
    if login.get("is_server_admin") and role == Role.ADMIN:
        role = Role.ROOT
    return ResolvedIdentity(
        role=role,
        account_id=account_id,
        user_id=user_id,
        from_session=True,
        group_ids=await manager.get_user_group_ids(account_id, user_id),
    )


async def session_response(
    request: Request, account_id: str, user_id: str, *, expected_version: str | None = None
) -> JSONResponse:
    manager = request.app.state.api_key_manager
    login = await manager.get_login_info(account_id, user_id)
    user = await manager.get_user_membership(account_id, user_id)
    if (
        not user
        or user.get("role") not in {Role.ADMIN, Role.USER}
        or user.get("disabled")
        or await manager.get_deletion(account_id, user_id)
    ):
        raise UnauthenticatedError("User is unavailable")
    if expected_version is not None and not hmac.compare_digest(
        expected_version, login.get("session_version", "")
    ):
        raise UnauthenticatedError("Login state changed; sign in again")
    if not login.get("session_version"):
        await manager.invalidate_sessions(account_id, user_id)
        login = await manager.get_login_info(account_id, user_id)
    if not login.get("session_version"):
        raise UnauthenticatedError("User is unavailable")
    lifetime = request.app.state.config.studio_session_hours * 3600
    token = sign_state(
        request,
        {
            "kind": "session",
            "account": account_id,
            "user": user_id,
            "version": login["session_version"],
            "exp": int(time.time()) + lifetime,
        },
    )
    response = JSONResponse({"status": "ok"})
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=lifetime,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
    )
    return response
