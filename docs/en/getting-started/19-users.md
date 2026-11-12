# User

A User is a data-owning identity within an Account. OpenViking uses it to separate personal memories, private sources, and sessions. Alice and Bob can each retain long-term context while using shared team sources.

A User is the identity accessing the service. An application can map it to a person or a separate application identity. Multiple agents using one User key share that user's space; use different users when their personal data needs to remain separate.

## Understand user space

Alice's directory looks like this:

```text
viking://user/alice/
├── memories/    # Alice's long-term memories
├── resources/   # Alice's private sources
├── skills/      # Alice's private skills
├── peers/       # Alice's interaction counterparts
└── sessions/    # Alice's conversations
```

`viking://~/` aliases the current user's home directory. It expands to `viking://user/alice/` for Alice and `viking://user/bob/` for Bob. Shared sources live under `viking://resources/` in the same account.

## Prerequisites

### Sign in to self-hosted Studio

With `server.root_api_key` configured in `api_key` mode, `/studio/` opens a dedicated sign-in page. On the first deployment, choose **Initialize administrator** and enter the account, username, a 12–128 character password and the server root key. This administrator has platform privileges. Subsequent sign-ins require only the account, username and password.

In **User management**, administrators can create users with initial passwords, delete or disable users, enable them again and reset passwords. Disabling retains data while blocking browser sessions, API keys and OAuth access. The current identity and the last active administrator cannot be disabled. Account administrators cannot modify platform administrator identities.

Users can change their passwords and manage personal API keys under **My account**. A new key accepts a label and can be rotated or deleted independently. Copy generated secrets immediately: they are shown only once. Browser login is independent of SDK credentials, so deleting every personal API key does not end the browser session. SDK and CLI authentication continues to use API keys.

Sessions use HttpOnly cookies and expire after 12 hours by default. Logout or a password change revokes the user's existing browser sessions. Set `server.studio_session_hours` to 1–168 hours to change the lifetime, or `server.studio_login_enabled: false` to disable browser login. Use HTTPS for network deployments and forward the correct request scheme through the reverse proxy.

### OIDC single sign-on

A platform administrator can open **Configuration → Server** and complete the **Single sign-on (OIDC)** form with the issuer, client ID, client secret and identity mappings. Register the displayed redirect URI with the identity provider:

SSO requires the optional JWT dependency. If it is not installed, run `pip install 'python-jose[cryptography]'` in the server's Python environment and restart the service.

```text
https://your-server/api/v1/auth/oidc/callback
```

Apply the form to the draft, save the configuration and restart the server. The sign-in page will offer SSO while retaining local password login. Create matching local users first: mapped account and user IDs must match the local registry. OpenViking controls roles and suspension. The browser flow validates Authorization Code, PKCE, state and nonce.

File account stores preserve existing user records. Before upgrading an existing MySQL or Redis-MySQL deployment, apply `openviking/server/account_stores/sql/changes/0002_user_management_login.sql`. New deployments use the updated `sql/init.sql`.

### CLI example setup

Complete [Authentication](17-authentication.md), creating Alice and Bob as ordinary users in `acme` and saving `acme-alice` and `acme-bob` connections. This example creates an empty private directory and a session without triggering memory extraction.

## Create private content

Alice activates her connection, checks her identity, and creates a directory:

```bash
ov config switch acme-alice
ov health -o json
ov mkdir viking://~/resources/personal-check
ov ls viking://~/resources
```

The listing should include `personal-check`. Create a session owned by Alice with automatic commits disabled:

```bash
ov session new --session-id alice-user-check --no-auto-commit
ov session add-message alice-user-check --role user --content "This is Alice's personal project discussion."
ov session get alice-user-check
```

Check that the session contains the message. This saves conversation content; committing starts memory extraction. See [Memory usage](09-memory.md) for that workflow.

## Check as Bob

Bob lists his home directory with his own connection:

```bash
ov config switch acme-bob
ov ls viking://~/resources
```

This lists Bob's private sources. Try accessing the directory Alice just created:

```bash
ov ls viking://user/alice/resources/personal-check
```

Access should be denied. Account membership enables collaboration while personal spaces remain separated by User. To share selected knowledge, Alice publishes it as shared sources, as described in [Knowledge sharing](22-sharing.md).

## Users and roles

The User identifies the data owner; the role determines management capabilities:

| User role | Main capabilities |
| --- | --- |
| USER | Personal data operations and authorized shared-source access |
| ADMIN | Their own user space, account member management, and management of shared sources in the account |

An administrator's ordinary data requests still use their own User identity. In API key mode, changing identity headers cannot switch an administrator into Alice or Bob. Platform ROOT manages accounts and other platform operations; its key is not used to read ordinary tenant data.

Applications can reuse a user identity across conversations to accumulate long-term memory. Session IDs distinguish conversations; Peers distinguish stable interaction counterparts under that user.

## Check the result

Alice can access her directory and session. Bob's home alias resolves to his own space, and he cannot read Alice's private directory. If both see the same personal space, check whether they are sharing a key.

## Next steps

Read [Peer](20-peers.md) to organize sources and memories for different counterparts under one user. See [Admin API](../api/08-admin.md) for registration, roles, and key rotation.
