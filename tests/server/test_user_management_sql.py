"""Exercise the relational implementation with a portable SQL test database.

SQLite validates the ORM operations and credential scoping without an external
service; MySQL-specific locking remains covered by the opt-in store contracts.
"""

import base64
from datetime import datetime, timezone

import pytest
from sqlalchemy import BigInteger, DefaultClause, Integer, MetaData, String, event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from openviking.server.account_stores.mysql import MySQLAccountStore
from openviking.server.account_stores.mysql_schema import Base
from openviking.server.api_keys.key_mgr import generate_api_key
from openviking_cli.exceptions import FailedPreconditionError


class InlineRuntime:
    async def run(self, operation):
        return await operation()


@pytest.fixture(params=["hash", "encrypted"])
async def store(request, tmp_path):
    pytest.importorskip("aiosqlite")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/accounts.db")

    @event.listens_for(engine.sync_engine, "connect")
    def add_clock(connection, _record):
        connection.create_function(
            "utc_timestamp",
            1,
            lambda _precision: datetime.now(timezone.utc).replace(tzinfo=None).isoformat(sep=" "),
        )

    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        clone = table.to_metadata(metadata)
        for column in clone.columns:
            if isinstance(column.type, BigInteger):
                column.type = Integer()
            elif isinstance(column.type, String):
                column.type = column.type.copy()
                column.type.collation = None
            if column.name == "created_at":
                column.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    store = MySQLAccountStore(
        service_name="test",
        params={
            "host": "localhost",
            "port": 3306,
            "user": "test",
            "password": "test",
            "database": "test",
            "credential_storage": request.param,
            "credential_encryption_key": base64.urlsafe_b64encode(bytes(range(32))).decode(),
        },
        runtime=InlineRuntime(),
    )
    store._sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield store
    finally:
        await engine.dispose()


async def test_relational_keys_and_suspension(store):
    primary = generate_api_key("team", "admin")
    await store.create_account_with_api_key("team", "admin", primary)
    first_secret, second_secret = (
        generate_api_key("team", "admin"),
        generate_api_key("team", "admin"),
    )
    first = await store.create_api_key("team", "admin", first_secret, "Laptop")
    second = await store.create_api_key("team", "admin", second_secret, "CI")
    assert len(await store.list_api_keys("team", "admin")) == 3
    assert await store.verify_api_key(first_secret) == ("team", "admin")
    await store.rotate_api_key("team", "admin", first["key_id"], generate_api_key("team", "admin"))
    assert await store.verify_api_key(first_secret) is None
    assert await store.verify_api_key(second_secret) == ("team", "admin")
    await store.delete_api_key("team", "admin", second["key_id"])
    assert await store.verify_api_key(second_secret) is None
    with pytest.raises(FailedPreconditionError, match="last active"):
        await store.set_user_disabled("team", "admin", True)
    await store.create_user("team", "other-admin", "admin")
    await store.set_user_disabled("team", "admin", True)
    assert await store.verify_api_key(primary) is None
    assert (await store.get_user("team", "admin"))["disabled"]
    await store.set_user_disabled("team", "admin", False)
    assert await store.verify_api_key(primary) == ("team", "admin")


async def test_relational_login_versions_revoke_sessions(store):
    await store.create_account("team", "admin")
    await store.set_login_password("team", "admin", "encoded-password", server_admin=True)
    login = await store.get_login_info("team", "admin")
    assert login["password_hash"] == "encoded-password" and login["is_server_admin"]
    await store.invalidate_sessions("team", "admin")
    assert (await store.get_login_info("team", "admin"))["session_version"] != login[
        "session_version"
    ]
