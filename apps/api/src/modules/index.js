// Route registration. Every module mounts under /api/v1.
import approvalRoutes from './approvals/routes.js';
import auditRoutes from './audit/routes.js';
import authRoutes from './auth/routes.js';
import notificationRoutes from './notifications/routes.js';
import roleRoutes from './roles/routes.js';
import settingsRoutes from './settings/routes.js';
import userRoutes from './users/routes.js';

/** @param {import('fastify').FastifyInstance} app */
export async function registerModules(app) {
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(userRoutes, { prefix: '/api/v1/admin/users' });
  await app.register(roleRoutes, { prefix: '/api/v1/admin' });
  await app.register(settingsRoutes, { prefix: '/api/v1/admin' });
  await app.register(auditRoutes, { prefix: '/api/v1/audit' });
  await app.register(approvalRoutes, { prefix: '/api/v1' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
}
