// TanStack Query keys (CLAUDE.md code style: all keys in one place).
export const qk = {
  me: ['me'],
  loginOptions: ['login-options'],
  notifications: ['notifications'],
  approvalsInbox: (status = 'PENDING') => ['approvals', 'inbox', status],
  approvalsSent: ['approvals', 'sent'],
  approval: (id) => ['approvals', 'detail', id],
  approvalRules: ['admin', 'approval-rules'],
  users: (params) => ['admin', 'users', params],
  user: (id) => ['admin', 'users', 'detail', id],
  roles: ['admin', 'roles'],
  permissions: ['admin', 'permissions'],
  settings: (level) => ['admin', 'settings', level],
  audit: (params) => ['audit', params],
  outbox: (params) => ['admin', 'outbox', params],
  masters: (type, params) => ['masters', type, params],
  lookups: (brnch, types) => ['lookups', brnch, types],
};
