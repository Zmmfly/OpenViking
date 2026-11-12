-- Apply to an existing MySQL account store before upgrading OpenViking.
-- The legacy primary-credential unique constraint remains: named API keys use
-- NULL active_user_pk and are addressed by their unique credential_id.
ALTER TABLE `ov_accounts_users`
    ADD COLUMN disabled BOOLEAN NOT NULL DEFAULT 0,
    ADD COLUMN password_hash TEXT NULL,
    ADD COLUMN session_version VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN is_server_admin BOOLEAN NOT NULL DEFAULT 0;

ALTER TABLE `ov_accounts_credentials`
    ADD COLUMN label VARCHAR(128) NOT NULL DEFAULT '';
