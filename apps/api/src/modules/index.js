// Route registration. Every module mounts under /api/v1.
import authRoutes from './auth/routes.js';

/** @param {import('fastify').FastifyInstance} app */
export async function registerModules(app) {
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
}
