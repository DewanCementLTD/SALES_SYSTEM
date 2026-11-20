// Route registration. Every module mounts under /api/v1.
import approvalRoutes from './approvals/routes.js';
import auditRoutes from './audit/routes.js';
import authRoutes from './auth/routes.js';
import customerRoutes from './customers/routes.js';
import fileRoutes from './files/routes.js';
import geoRoutes from './geo/routes.js';
import masterRoutes from './masters/routes.js';
import notificationRoutes from './notifications/routes.js';
import outboxRoutes from './outbox/routes.js';
import roleRoutes from './roles/routes.js';
import settingsRoutes from './settings/routes.js';
import taxRoutes from './tax/routes.js';
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
  await app.register(outboxRoutes, { prefix: '/api/v1/admin' });
  await app.register(fileRoutes, { prefix: '/api/v1' });
  await app.register(masterRoutes, { prefix: '/api/v1' });
  await app.register(geoRoutes, { prefix: '/api/v1' });
  await app.register(customerRoutes, { prefix: '/api/v1' });
  await app.register(taxRoutes, { prefix: '/api/v1' });
}
