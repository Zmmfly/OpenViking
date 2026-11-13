export default {
  workspacesTitle: 'Accounts / workspaces',
  workspacesDescription:
    'Manage separate workspaces and their members. Memories and resources belong to each workspace.',
  workspacesRootRequired: 'Only platform administrators can manage workspaces.',
  workspaceId: 'Workspace ID',
  createWorkspace: 'Create workspace',
  createWorkspaceDescription:
    'Create a separate data space and its first account administrator. Set a password for browser sign-in.',
  initialAdministrator: 'Initial administrator username',
  workspaceCreated: 'Workspace {{account}} created',
  memberCount: 'Members',
  manageMembers: 'Manage users',
  searchWorkspaces: 'Search workspaces',
  noWorkspaces: 'No matching workspaces.',
  actions: 'Actions',
  refresh: 'Refresh',
  peersTitle: 'Peers',
  peersDescription:
    'Organize memories and reference material for people or collaborating agents within your user space.',
  peersUnavailable:
    'Peer management is available on self-hosted OpenViking servers.',
  peerScopeHint:
    'Each Peer has its own memory and resource directories. These belong to your user; your own memories and accessible shared resources remain available.',
  createPeer: 'Create Peer',
  createPeerDescription:
    'Choose a stable ID for this person or agent. Reusing an ID continues the same Peer space.',
  peerId: 'Peer ID',
  peerIdHint:
    'Use letters, numbers, dots, underscores, hyphens and at most one @, up to 255 characters. Path separators, . and .., and the reserved ID __self are not allowed.',
  peerCreated: 'Peer space is ready',
  searchPeers: 'Search Peers',
  noPeers: 'No Peers yet. Create one to organize its memories and resources.',
  peerMemories: 'View memories',
  peerResources: 'View resources',
  newPeerSession: 'New Peer session',
  newSessionDescription:
    'Choose whose memories this session should build. The selection stays with this session.',
  sessionMemoryScope: 'Memory target',
  selfMemory: 'My memories',
  peerSessionHint:
    'Messages will identify the selected Peer. Committing extracts Peer memories only; your own memories and accessible shared resources can still be read.',
  selfSessionHint: 'Use your existing memory extraction policy.',
  peerSessionLabel: 'Peer: {{peer}}',
  createSession: 'Create session',
  usersDescription: 'Manage members, roles and sign-in access in this account.',
  userListDescription:
    'Add users, set passwords, change roles, or disable and remove access.',
  createUserDescription:
    'Create a user in {{accountId}} and set an initial sign-in password.',
  accessDenied: 'Only account and platform administrators can manage users.',
  serverAdministrator: 'Platform administrator',
  serverAdministratorOnly:
    'Only platform administrators can modify this identity.',
  requestFailed: 'Request failed ({{status}})',
  loading: 'Loading…',
  retry: 'Retry',
  account: 'Account',
  username: 'Username',
  password: 'Password',
  loginTitle: 'Sign in to OpenViking',
  loginDescription: 'Use your account to open your workspace.',
  login: 'Sign in',
  logout: 'Sign out',
  oidcLogin: 'Sign in with SSO',
  backToLogin: 'Back to sign in',
  setupLink: 'First deployment? Initialize an administrator',
  setupTitle: 'Initialize administrator',
  setupDescription:
    'Create the first local administrator using the server setup credential. Daily sign-in uses your password.',
  setupCredential: 'Server root key (setup only)',
  createAdministrator: 'Create administrator',
  confirmPassword: 'Confirm password',
  passwordMismatch: 'Passwords do not match.',
  passwordHint:
    'Use 12–128 characters. Share initial passwords through a private channel.',
  sessionIdentity:
    'Your browser session uses your signed-in identity. Sign out to use another account.',
  accountTitle: 'My account',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  passwordChanged:
    'Password updated. Other browser sessions have been signed out.',
  passwordReset: 'Set password',
  passwordResetDescription:
    'Set a new local sign-in password for {{user}}. Existing browser sessions will be signed out.',
  passwordSaved: 'Password saved',
  save: 'Save',
  cancel: 'Cancel',
  enabled: 'Active',
  disabled: 'Disabled',
  disable: 'Disable user',
  enable: 'Enable user',
  disableDescription:
    'Disable {{user}}? Their browser sessions, API keys and OAuth access will stop working. Their data will be retained.',
  userUpdated: 'User access updated',
  keysTitle: 'My API keys',
  keysDescription:
    'Use keys for SDKs and applications. Each key can be rotated or deleted independently.',
  addKey: 'Create API key',
  label: 'Label',
  labelPlaceholder: 'For example: development laptop',
  createdAt: 'Created',
  unnamed: 'Unlabeled',
  legacyKey: 'Initial key',
  noKeys: 'No API keys yet.',
  rotate: 'Rotate',
  delete: 'Delete',
  keyCreated: 'API key created',
  keyRotated: 'API key rotated',
  keyDeleted: 'API key deleted',
  secretTitle: 'Save your API key',
  secretDescription:
    'Copy this key now. The full secret will not be shown again.',
  copy: 'Copy',
  copied: 'Copied',
  done: 'Done',
  rotateTitle: 'Rotate API key?',
  rotateDescription:
    'The old key stops working immediately. Update applications using this key.',
  deleteTitle: 'Delete API key?',
  deleteDescription:
    'Applications using this key will lose access immediately.',
  oidcTitle: 'Single sign-on (OIDC)',
  oidcDescription:
    'Connect your identity provider. Local password login remains available for recovery.',
  oidcEnabled: 'Enable SSO login',
  issuer: 'Issuer URL',
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  audience: 'API token audience (optional)',
  jwksUri: 'JWKS URL (optional)',
  accountMapping: 'Account mapping',
  fixedAccount: 'Fixed account',
  accountClaim: 'Account claim',
  userClaim: 'User ID claim',
  callback: 'Redirect URI to register with your provider',
  oidcApply: 'Apply to draft',
  oidcHint:
    'Add users in User management first. Mapped IDs must match those users. Roles are managed locally.',
  oidcRestart:
    'Save the configuration and restart the server to apply SSO changes.',
  oidcInvalid:
    'Enter a valid issuer URL, client ID, account mapping and user ID claim.',
  oidcAdvanced: 'Advanced settings',
  oidcReadOnly:
    'Use the file editor for environment references or advanced identity mapping.',
} as const
