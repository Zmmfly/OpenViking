from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from openviking.message import TextPart
from openviking.server.identity import RequestContext, Role
from openviking.server.routers.sessions import CreateSessionRequest
from openviking.service.session_service import SessionService
from openviking.session.memory.memory_type_registry import MemoryTypeRegistry
from openviking.session.session import Session, SessionMeta
from openviking.system_assets import builtin_memory_templates_dir
from openviking_cli.exceptions import InvalidArgumentError
from openviking_cli.session.user_id import UserIdentifier


def context():
    return RequestContext(user=UserIdentifier("team", "alice"), role=Role.USER)


@pytest.fixture(autouse=True)
def memory_registry(monkeypatch):
    registry = MemoryTypeRegistry(load_schemas=False)
    registry.load_from_directory(str(builtin_memory_templates_dir()))
    monkeypatch.setattr("openviking.service.session_service.get_default_registry", lambda: registry)


async def test_peer_session_persists_target_and_preserves_user_memory_type_policy(monkeypatch):
    service = SessionService()
    session = SimpleNamespace(
        meta=SessionMeta(), ensure_exists=AsyncMock(), exists=AsyncMock(return_value=False)
    )
    monkeypatch.setattr(service, "session", Mock(return_value=session))
    policy = {
        "self": {"enabled": True},
        "peer": {"enabled": False},
        "memory_types": ["preferences"],
        "working_memory": {"enabled": True},
    }
    monkeypatch.setattr(service, "_get_user_memory_policy", AsyncMock(return_value=policy))
    await service.create(context(), "peer-chat", peer_id=" review-agent ")
    restored = SessionMeta.from_dict(session.meta.to_dict())
    assert restored.peer_id == "review-agent"
    assert restored.memory_policy == {
        **policy,
        "self": {"enabled": False},
        "peer": {"enabled": True},
    }
    assert policy["self"]["enabled"] and not policy["peer"]["enabled"]
    session.ensure_exists.assert_awaited_once()


async def test_legacy_session_and_explicit_policy_keep_existing_behavior(monkeypatch):
    service = SessionService()
    session = SimpleNamespace(
        meta=SessionMeta(), ensure_exists=AsyncMock(), exists=AsyncMock(return_value=False)
    )
    monkeypatch.setattr(service, "session", Mock(return_value=session))
    inherited = AsyncMock()
    monkeypatch.setattr(service, "_get_user_memory_policy", inherited)
    await service.create(context(), "self-chat")
    assert "peer_id" not in session.meta.to_dict()
    assert session.meta.memory_policy is None
    policy = {"self": {"enabled": True}, "peer": {"enabled": False}}
    await service.create(context(), "explicit-chat", peer_id="review-agent", memory_policy=policy)
    assert session.meta.memory_policy["self"]["enabled"]
    assert not session.meta.memory_policy["peer"]["enabled"]
    inherited.assert_not_called()


@pytest.mark.parametrize("peer_id", ["../other", "a/b", "__self"])
async def test_invalid_peer_target_cannot_create_session(monkeypatch, peer_id):
    service = SessionService()
    session = SimpleNamespace(
        meta=SessionMeta(), ensure_exists=AsyncMock(), exists=AsyncMock(return_value=False)
    )
    monkeypatch.setattr(service, "session", Mock(return_value=session))
    with pytest.raises((ValueError, InvalidArgumentError)):
        await service.create(context(), "bad-peer", peer_id=peer_id)
    session.ensure_exists.assert_not_called()


@pytest.mark.parametrize("peer_id", ["../other", "a/b", "a\\b", "a@b@c"])
def test_peer_id_request_validation(peer_id):
    with pytest.raises(ValueError):
        CreateSessionRequest(peer_id=peer_id)


@pytest.mark.parametrize("default_peer", [None, "review-agent"])
async def test_default_peer_tags_user_messages_without_overriding_explicit_speakers(default_peer):
    session = Session(viking_fs=None, ctx=context())
    session.meta.peer_id = default_peer
    session._tool_outputs = SimpleNamespace(externalize_group=AsyncMock())
    specs = [
        {"role": "user", "parts": [TextPart("remember my preference")]},
        {"role": "assistant", "parts": [TextPart("understood")]},
        {"role": "user", "peer_id": "another-peer", "parts": [TextPart("explicit speaker")]},
    ]
    messages = await session.add_messages_async(specs)
    assert [message.peer_id for message in messages] == [default_peer, None, "another-peer"]
    assert "peer_id" not in specs[0]
    assert session.messages == messages
