"""Browser login, user suspension and independent personal key lifecycles."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from argon2 import PasswordHasher

from openviking.server.app import create_app
from openviking.server.auth.plugins.api_key import ApiKeyAuthPlugin
from openviking.server.config import ServerConfig
from openviking.server.dependencies import set_service
from openviking.server.identity import Role
from openviking.server.store_assembly import build_api_key_manager
from openviking_cli.exceptions import FailedPreconditionError, UnauthenticatedError
from tests.server.account_store_fakes import InMemoryAGFS

ROOT_KEY = "studio-root-secret-for-tests"
PASSWORD = "initial-password-for-tests"


@pytest.fixture
async def runtime(monkeypatch):
    monkeypatch.setattr(
        "openviking.server.app.get_openviking_config",
        lambda: SimpleNamespace(service_name="test", default_account="default"),
    )
    monkeypatch.setattr("openviking.server.app.create_embedded_gateway", lambda *args: None)
    service = SimpleNamespace(
        viking_fs=SimpleNamespace(agfs=InMemoryAGFS()), initialize_user_directories=AsyncMock()
    )
    manager = build_api_key_manager(root_key=ROOT_KEY, viking_fs=service.viking_fs)
    await manager.load()
    config = ServerConfig(auth_mode="api_key", root_api_key=ROOT_KEY)
    app = create_app(config=config, service=service)
    app.state.auth_plugin = ApiKeyAuthPlugin()
    app.state.api_key_manager = manager
    set_service(service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"X-OpenViking-CSRF": "1"},
    ) as client:
        yield SimpleNamespace(client=client, manager=manager, service=service, app=app)
    await manager.close()


async def _bootstrap(runtime):
    response = await runtime.client.post(
        "/api/v1/auth/bootstrap",
        json={
            "account_id": "team",
            "user_id": "admin",
            "password": PASSWORD,
            "root_key": ROOT_KEY,
        },
    )
    assert response.status_code == 200, response.text
    return runtime.client.cookies.get("ov_studio_session")


async def _add_user(runtime, user_id="alice", **extra):
    response = await runtime.client.post(
        "/api/v1/admin/accounts/team/users",
        json={
            "user_id": user_id,
            "password": PASSWORD,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["result"]["user_key"]


async def test_bootstrap_password_login_and_logout_revoke_copied_cookie(runtime):
    client = runtime.client
    assert not (await client.get("/api/v1/auth/session")).json()["result"]["authenticated"]
    cookie = await _bootstrap(runtime)
    attributes = (
        await client.post(
            "/api/v1/auth/login",
            json={"account_id": "team", "user_id": "admin", "password": PASSWORD},
        )
    ).headers["set-cookie"]
    assert "HttpOnly" in attributes and "SameSite=lax" in attributes
    session = (await client.get("/api/v1/auth/session")).json()["result"]
    assert session["authenticated"] and session["role"] == "root"
    assert session["user_id"] == "admin"
    assert "api_key" not in session
    members = await client.get("/api/v1/admin/accounts/team/users")
    assert members.headers["cache-control"] == "no-store"
    assert (await client.post("/api/v1/auth/logout")).status_code == 200
    client.cookies.set("ov_studio_session", cookie)
    assert not (await client.get("/api/v1/auth/session")).json()["result"]["authenticated"]
    assert (await client.get("/api/v1/me/api-keys")).status_code == 401


async def test_local_user_manages_labeled_keys_without_api_key(runtime):
    client = runtime.client
    await _bootstrap(runtime)
    primary = await _add_user(runtime)
    await client.post("/api/v1/auth/logout")
    login = await client.post(
        "/api/v1/auth/login", json={"account_id": "team", "user_id": "alice", "password": PASSWORD}
    )
    assert login.status_code == 200
    assert (await client.get("/api/v1/auth/session")).json()["result"]["role"] == "user"
    assert (
        await client.post("/api/v1/admin/accounts/team/users", json={"user_id": "outsider"})
    ).status_code == 403
    first = (await client.post("/api/v1/me/api-keys", json={"label": "开发笔记本"})).json()[
        "result"
    ]
    second = (await client.post("/api/v1/me/api-keys", json={"label": "CI"})).json()["result"]
    listing = (await client.get("/api/v1/me/api-keys")).json()["result"]
    assert len(listing) == 3
    assert {key["label"] for key in listing} >= {"开发笔记本", "CI"}
    assert all("api_key" not in key for key in listing)
    rotated = (await client.post(f"/api/v1/me/api-keys/{first['key_id']}/rotate")).json()["result"]
    assert rotated["label"] == first["label"] and rotated["key_id"] == first["key_id"]
    with pytest.raises(UnauthenticatedError):
        await runtime.manager.resolve_identity(first["api_key"])
    assert (await runtime.manager.resolve_identity(rotated["api_key"])).user_id == "alice"
    assert (await runtime.manager.resolve_identity(second["api_key"])).user_id == "alice"
    assert (await runtime.manager.resolve_identity(primary)).user_id == "alice"
    assert (await client.delete(f"/api/v1/me/api-keys/{second['key_id']}")).status_code == 200
    with pytest.raises(UnauthenticatedError):
        await runtime.manager.resolve_identity(second["api_key"])
    # Deleting all SDK keys does not sign the browser out.
    for key in (await client.get("/api/v1/me/api-keys")).json()["result"]:
        assert (await client.delete(f"/api/v1/me/api-keys/{key['key_id']}")).status_code == 200
    assert (await client.get("/api/v1/me/api-keys")).json()["result"] == []
    assert (await client.get("/api/v1/auth/session")).json()["result"]["authenticated"]


async def test_disable_blocks_browser_sdk_oauth_and_reenable_keeps_old_session_revoked(runtime):
    client = runtime.client
    admin_cookie = await _bootstrap(runtime)
    primary = await _add_user(runtime)
    await client.post("/api/v1/auth/logout")
    await client.post(
        "/api/v1/auth/login", json={"account_id": "team", "user_id": "alice", "password": PASSWORD}
    )
    alice_cookie = client.cookies.get("ov_studio_session")
    key = (await client.post("/api/v1/me/api-keys", json={"label": "service"})).json()["result"]
    # Sign the administrator in again; never exchange the browser cookie for an API key.
    await client.post(
        "/api/v1/auth/login", json={"account_id": "team", "user_id": "admin", "password": PASSWORD}
    )
    response = await client.put(
        "/api/v1/admin/accounts/team/users/alice/disabled", json={"disabled": True}
    )
    assert response.status_code == 200
    for secret in (primary, key["api_key"]):
        with pytest.raises(UnauthenticatedError):
            await runtime.manager.resolve_identity(secret)
    with pytest.raises(UnauthenticatedError):
        await runtime.manager.resolve_oauth_identity("team", "alice", Role.USER)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=runtime.app),
        base_url="http://testserver",
        cookies={"ov_studio_session": alice_cookie},
    ) as alice:
        assert not (await alice.get("/api/v1/auth/session")).json()["result"]["authenticated"]
        assert (
            await alice.post(
                "/api/v1/auth/login",
                headers={"X-OpenViking-CSRF": "1"},
                json={"account_id": "team", "user_id": "alice", "password": PASSWORD},
            )
        ).status_code == 401
        assert (
            await client.put(
                "/api/v1/admin/accounts/team/users/alice/disabled", json={"disabled": False}
            )
        ).status_code == 200
        assert not (await alice.get("/api/v1/auth/session")).json()["result"]["authenticated"]
    assert (await runtime.manager.resolve_identity(primary)).user_id == "alice"
    assert admin_cookie


async def test_password_reset_revokes_browser_and_old_password(runtime):
    client = runtime.client
    await _bootstrap(runtime)
    await _add_user(runtime)
    await client.post(
        "/api/v1/auth/login", json={"account_id": "team", "user_id": "alice", "password": PASSWORD}
    )
    cookie = client.cookies.get("ov_studio_session")
    await client.post(
        "/api/v1/auth/login", json={"account_id": "team", "user_id": "admin", "password": PASSWORD}
    )
    new_password = "new-password-for-alice"
    reset = await client.put(
        "/api/v1/admin/accounts/team/users/alice/password", json={"password": new_password}
    )
    assert reset.status_code == 200
    client.cookies.clear()
    client.cookies.set("ov_studio_session", cookie)
    assert not (await client.get("/api/v1/auth/session")).json()["result"]["authenticated"]
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"account_id": "team", "user_id": "alice", "password": PASSWORD},
        )
    ).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"account_id": "team", "user_id": "alice", "password": new_password},
        )
    ).status_code == 200


async def test_cross_origin_writes_and_self_disable_are_rejected(runtime):
    client = runtime.client
    await _bootstrap(runtime)
    assert (
        await client.post(
            "/api/v1/me/api-keys",
            headers={"Origin": "https://evil.example"},
            json={"label": "attack"},
        )
    ).status_code == 403
    assert (
        await client.put(
            "/api/v1/admin/accounts/team/users/admin/disabled", json={"disabled": True}
        )
    ).status_code == 403
    with pytest.raises(FailedPreconditionError, match="last active"):
        await runtime.manager.set_user_disabled("team", "admin", True)
    assert (
        await client.get("/api/v1/me/api-keys", headers={"Origin": "https://evil.example"})
    ).status_code == 403


async def test_account_admin_cannot_take_over_server_administrator(runtime):
    client = runtime.client
    await _bootstrap(runtime)
    await _add_user(runtime, "team-admin", role="admin")
    await client.post(
        "/api/v1/auth/login",
        json={"account_id": "team", "user_id": "team-admin", "password": PASSWORD},
    )
    for suffix, body in (
        ("password", {"password": "attacker-controlled-password"}),
        ("disabled", {"disabled": True}),
        ("role", {"role": "user"}),
    ):
        assert (
            await client.put(f"/api/v1/admin/accounts/team/users/admin/{suffix}", json=body)
        ).status_code == 403
    assert (await client.delete("/api/v1/admin/accounts/team/users/admin")).status_code == 403


async def test_server_administrator_role_is_fixed_even_with_another_admin(runtime):
    client = runtime.client
    await _bootstrap(runtime)
    await _add_user(runtime, "team-admin", role="admin")
    url = "/api/v1/admin/accounts/team/users/admin/role"
    for headers in ({}, {"X-API-Key": ROOT_KEY}):
        response = await client.put(url, json={"role": "user"}, headers=headers)
        assert response.status_code == 403
        assert "Server administrator role cannot be changed" in response.text
    assert (await client.put(url, json={"role": "admin"})).status_code == 200
    # Ordinary account administrators can still be demoted by ROOT.
    assert (
        await client.put("/api/v1/admin/accounts/team/users/team-admin/role", json={"role": "user"})
    ).status_code == 200
    assert (await client.get("/api/v1/auth/session")).json()["result"]["role"] == "root"


@pytest.mark.parametrize(
    "valid_nonce,missing_claim", [(True, None), (False, None), (True, "aud"), (True, "exp")]
)
@pytest.mark.parametrize("client_auth", [None, "client_secret_basic", "client_secret_post"])
async def test_oidc_authorization_code_pkce_and_nonce(
    runtime, monkeypatch, valid_nonce, missing_claim, client_auth
):
    import base64
    import time
    from urllib.parse import parse_qs, urlsplit

    from jose import jwt

    from openviking.server.auth.oidc_config import OIDCConfig

    client = runtime.client
    await _bootstrap(runtime)
    await _add_user(runtime)
    runtime.app.state.config.oidc = OIDCConfig(
        issuer="https://idp.example",
        client_id="studio",
        audience="openviking-api",
        client_secret="provider-client-secret" if client_auth else None,
        identity={"account_id": {"source": "fixed", "value": "team"}},
    )
    saved = {}
    secret = "identity-provider-signing-secret-for-tests"
    original_client = httpx.AsyncClient

    def idp(request):
        if request.url.path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": "https://idp.example",
                    "authorization_endpoint": "https://idp.example/authorize",
                    "token_endpoint": "https://idp.example/token",
                    "jwks_uri": "https://idp.example/jwks",
                    "token_endpoint_auth_methods_supported": [client_auth]
                    if client_auth
                    else ["none"],
                },
            )
        if request.url.path == "/jwks":
            return httpx.Response(
                200,
                json={
                    "keys": [
                        {
                            "kty": "oct",
                            "kid": "test",
                            "alg": "HS256",
                            "k": base64.urlsafe_b64encode(secret.encode()).decode().rstrip("="),
                        }
                    ]
                },
            )
        assert request.url.path == "/token"
        body = parse_qs(request.content.decode())
        assert body["code_verifier"] == [saved["verifier"]]
        assert body["redirect_uri"] == ["http://testserver/api/v1/auth/oidc/callback"]
        if client_auth == "client_secret_basic":
            assert request.headers["authorization"].startswith("Basic ")
            assert "client_secret" not in body
        elif client_auth == "client_secret_post":
            assert body["client_secret"] == ["provider-client-secret"]
        else:
            assert "authorization" not in request.headers and "client_secret" not in body
        claims = {
            "iss": "https://idp.example",
            "aud": "studio",
            "sub": "alice",
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
            "nonce": saved["nonce"] if valid_nonce else "wrong-nonce",
        }
        if missing_claim:
            claims.pop(missing_claim)
        token = jwt.encode(
            claims,
            secret,
            algorithm="HS256",
            headers={"kid": "test"},
        )
        return httpx.Response(200, json={"id_token": token})

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(idp), **kwargs),
    )
    start = await client.get("/api/v1/auth/oidc/login")
    assert start.status_code == 302
    query = parse_qs(urlsplit(start.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    cookie = client.cookies.get("ov_studio_oidc").split(".")[0]
    saved.update(json.loads(base64.urlsafe_b64decode(cookie + "=" * (-len(cookie) % 4))))
    callback = await client.get(
        "/api/v1/auth/oidc/callback",
        params={"code": "code-from-provider", "state": query["state"][0]},
    )
    accepted = valid_nonce and not missing_claim
    assert callback.status_code == (302 if accepted else 401), callback.text
    if accepted:
        session = (await client.get("/api/v1/auth/session")).json()["result"]
        assert (
            session["authenticated"] and session["user_id"] == "alice" and session["role"] == "user"
        )


async def test_keys_are_hashed_persisted_and_concurrent_additions_are_preserved(runtime):
    manager = runtime.manager
    await manager.create_account("team", "admin")
    await manager.register_user("team", "alice")
    peer = build_api_key_manager(root_key=ROOT_KEY, viking_fs=runtime.service.viking_fs)
    await peer.load()
    try:
        first, second = await asyncio.gather(
            manager.create_api_key("team", "alice", "first"),
            peer.create_api_key("team", "alice", "second"),
        )
        rows = await manager.list_api_keys("team", "alice")
        assert len(rows) == 3
        data = runtime.service.viking_fs.agfs.read("/local/team/_system/users.json")
        assert first["api_key"].encode() not in data and second["api_key"].encode() not in data
        records = json.loads(data)["users"]["alice"]["api_keys"]
        assert all(record["key"].startswith("$argon2") for record in records.values())
        fresh = build_api_key_manager(root_key=ROOT_KEY, viking_fs=runtime.service.viking_fs)
        await fresh.load()
        try:
            assert (await fresh.resolve_identity(first["api_key"])).user_id == "alice"
            assert (await fresh.resolve_identity(second["api_key"])).user_id == "alice"
        finally:
            await fresh.close()
    finally:
        await peer.close()


async def test_password_hash_is_not_exposed_and_oauth_tracks_the_exact_key(runtime):
    manager = runtime.manager
    await _bootstrap(runtime)
    await _add_user(runtime)
    first = await manager.create_api_key("team", "alice", "one")
    second = await manager.create_api_key("team", "alice", "two")
    fp = await manager.get_user_key_fingerprint("team", "alice", first["api_key"])
    assert await manager.is_key_fingerprint_active("team", "alice", fp)
    await manager.rotate_api_key("team", "alice", second["key_id"])
    assert await manager.is_key_fingerprint_active("team", "alice", fp)
    await manager.delete_api_key("team", "alice", first["key_id"])
    assert not await manager.is_key_fingerprint_active("team", "alice", fp)
    data = await manager.get_login_info("team", "alice")
    assert PasswordHasher().verify(data["password_hash"], PASSWORD)
    listed = (await runtime.client.get("/api/v1/admin/accounts/team/users")).text
    assert "password_hash" not in listed and "$argon2" not in listed


async def test_suspension_is_observed_by_another_worker_without_waiting_for_watcher(runtime):
    manager = runtime.manager
    await manager.create_account("team", "admin")
    primary = await manager.register_user("team", "alice")
    peer = build_api_key_manager(root_key=ROOT_KEY, viking_fs=runtime.service.viking_fs)
    await peer.load()
    try:
        fingerprint = await peer.get_user_key_fingerprint("team", "alice", primary)
        assert await peer.get_registered_user_role("team", "alice") == Role.USER
        await manager.set_user_disabled("team", "alice", True)
        assert await peer.get_registered_user_role("team", "alice") is None
        assert not await peer.is_key_fingerprint_active("team", "alice", fingerprint)
        with pytest.raises(UnauthenticatedError):
            await peer.resolve_identity(primary)
    finally:
        await peer.close()


async def test_browser_service_forwarding_is_user_scoped_and_revocable(runtime):
    from fastapi import Depends, Request

    from openviking.server.auth import get_request_context
    from openviking.server.routers.bot import _attach_openviking_connection

    @runtime.app.get("/api/v1/me/test-forwarding")
    async def forwarding(request: Request, ctx=Depends(get_request_context)):
        return _attach_openviking_connection({}, request, ctx)["openviking_connection"]

    client = runtime.client
    await _bootstrap(runtime)
    forwarded = (await client.get("/api/v1/me/test-forwarding")).json()
    token = forwarded["api_key"]
    assert forwarded["account_id"] == "team" and forwarded["user_id"] == "admin"
    identity = await runtime.manager.resolve_identity(token)
    assert identity.role == Role.ADMIN and identity.from_oauth and not identity.from_session
    # A service token cannot mint personal keys or platform administrator rights.
    denied = await client.post(
        "/api/v1/me/api-keys", headers={"X-API-Key": token}, json={"label": "delegated"}
    )
    assert denied.status_code == 403
    assert (await client.post("/api/v1/auth/logout")).status_code == 200
    with pytest.raises(UnauthenticatedError):
        await runtime.manager.resolve_identity(token)


async def test_stored_root_role_cannot_grant_platform_authority_through_a_cookie(runtime):
    await _bootstrap(runtime)
    agfs = runtime.service.viking_fs.agfs
    path = "/local/team/_system/users.json"
    users = json.loads(agfs.read(path))
    users["users"]["admin"]["role"] = "root"
    agfs.write(path, json.dumps(users).encode())
    session = (await runtime.client.get("/api/v1/auth/session")).json()["result"]
    assert not session["authenticated"]
    assert (await runtime.client.get("/api/v1/me/api-keys")).status_code == 401


async def test_legacy_reset_preserves_peer_password_and_cannot_undo_suspension(runtime):
    manager = runtime.manager
    await manager.create_account("team", "admin")
    await manager.register_user("team", "alice")
    peer = build_api_key_manager(
        root_key=ROOT_KEY,
        viking_fs=runtime.service.viking_fs,
        account_store_watch_enabled=True,
        account_store_watch_interval_seconds=60,
    )
    await peer.load()
    try:
        await manager.set_login_password("team", "alice", PASSWORD)
        await manager.set_user_disabled("team", "alice", True)
        with pytest.raises(FailedPreconditionError, match="disabled"):
            await peer.regenerate_key("team", "alice")
        assert (await manager.get_user_membership("team", "alice"))["disabled"]
        await manager.set_user_disabled("team", "alice", False)
        before = await manager.get_login_info("team", "alice")
        await peer.regenerate_key("team", "alice")
        assert await manager.get_login_info("team", "alice") == before
    finally:
        await peer.close()


async def test_user_removal_revokes_all_keys_and_browser_session(runtime):
    client = runtime.client
    await _bootstrap(runtime)
    primary = await _add_user(runtime)
    extra = await runtime.manager.create_api_key("team", "alice", "application")
    await client.post(
        "/api/v1/auth/login", json={"account_id": "team", "user_id": "alice", "password": PASSWORD}
    )
    await runtime.manager.begin_deletion(
        "team", "alice", task_id="delete-alice", owner_account_id="team", owner_user_id="admin"
    )
    for key in (primary, extra["api_key"]):
        with pytest.raises(UnauthenticatedError):
            await runtime.manager.resolve_identity(key)
    assert not (await client.get("/api/v1/auth/session")).json()["result"]["authenticated"]
    assert await runtime.manager.finish_deletion("team", "alice", "delete-alice")
    assert await runtime.manager.get_user("team", "alice") is None
