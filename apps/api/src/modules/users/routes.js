// /api/v1/admin/users (API_SPEC §3)
import { P, zBrnch, zMobile, zPage, zPageQuery, zReason } from '@dcl/shared';
import { z } from 'zod';
import { etag, ifMatch } from '../../lib/http.js';
import * as repo from './repo.js';
import * as svc from './service.js';

const zAccess = z
  .array(
    z.object({
      brnch: zBrnch,
      isDefault: z.boolean().default(false),
      roles: z.array(z.string().min(1).max(30)).default([]),
    }),
  )
  .max(2);

const zHhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
  .nullable()
  .optional();

const zUserFields = z.object({
  fullName: z.string().trim().min(2).max(100),
  designation: z.string().trim().max(60).nullable().optional(),
  email: z.string().trim().email().max(100).nullable().optional(),
  mobile: zMobile.nullable().optional(),
  homeBrnch: zBrnch,
  allowedFrom: zHhmm,
  allowedTo: zHhmm,
});

const zUser = z.object({
  userId: z.number(),
  usrid: z.string(),
  fullName: z.string(),
  designation: z.string().nullable(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  status: z.string(),
  homeBrnch: z.number(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.date().nullable(),
  allowedFrom: z.string().nullable(),
  allowedTo: z.string().nullable(),
  lastLoginOn: z.date().nullable(),
  rowVer: z.number(),
});

const zAccessOut = z.array(
  z.object({ brnch: z.number(), isDefault: z.boolean(), roles: z.array(z.string()) }),
);
const zUserId = z.object({ userId: z.coerce.number().int().positive() });
const zTempPwd = z.object({ temporaryPassword: z.string() });
const zOk = z.object({ ok: z.literal(true) });

/** @param {import('fastify').FastifyInstance} app */
export default async function userRoutes(app) {
  /** Actor context for the service. */
  async function actor(request, tx) {
    return {
      userId: request.session.userId,
      usrid: request.session.usrid,
      scope: await request.authz.branchesWith(P.admin.users),
      isSysAdmin: await repo.hasRoleAnywhere(tx, request.session.userId, 'SYS_ADMIN'),
      audit: request.ctx(),
      now: app.clock.now(),
    };
  }
  const tags = ['admin'];
  const permission = P.admin.users;

  app.get(
    '/',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'List users of my branches',
        querystring: zPageQuery.extend({
          status: z.enum(['ACTIVE', 'LOCKED', 'DISABLED']).optional(),
        }),
        response: { 200: zPage(zUser) },
      },
    },
    async (request) =>
      app.db.read(async (tx) => {
        const a = await actor(request, tx);
        return repo.listUsers(tx, { branches: a.isSysAdmin ? [1, 2] : a.scope, ...request.query });
      }, request.txOpts('users.list')),
  );

  app.post(
    '/',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'Create a user (temporary password returned once)',
        body: zUserFields.extend({
          usrid: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_.-]{2,20}$/),
          access: zAccess.min(1),
        }),
        response: { 201: z.object({ userId: z.number(), temporaryPassword: z.string() }) },
      },
    },
    async (request, reply) => {
      const res = await app.db.withTx(
        async (tx) => svc.createUser(tx, await actor(request, tx), request.body),
        request.txOpts('users.create'),
      );
      return reply.status(201).send(res);
    },
  );

  app.get(
    '/:userId',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'User with branches and roles',
        params: zUserId,
        response: { 200: zUser.extend({ access: zAccessOut }) },
      },
    },
    async (request, reply) => {
      const u = await app.db.read(
        async (tx) => svc.getUserDetail(tx, await actor(request, tx), request.params.userId),
        request.txOpts('users.get'),
      );
      reply.header('etag', etag(u.rowVer));
      return u;
    },
  );

  app.put(
    '/:userId',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'Update user details (If-Match)',
        params: zUserId,
        body: zUserFields,
        response: { 200: zOk },
      },
    },
    async (request) => {
      const ver = ifMatch(request);
      await app.db.withTx(
        async (tx) =>
          svc.updateUser(tx, await actor(request, tx), request.params.userId, ver, request.body),
        request.txOpts('users.update'),
      );
      return { ok: true };
    },
  );

  for (const [path, status] of [
    ['lock', 'LOCKED'],
    ['unlock', 'ACTIVE'],
  ]) {
    app.post(
      `/:userId/${path}`,
      {
        config: { permission },
        schema: {
          tags,
          summary: `${path === 'lock' ? 'Lock' : 'Unlock'} a user`,
          params: zUserId,
          body: z.object({ reason: path === 'lock' ? zReason : zReason.optional() }).optional(),
          response: { 200: zOk },
        },
      },
      async (request) => {
        await app.db.withTx(
          async (tx) =>
            svc.setUserStatus(
              tx,
              await actor(request, tx),
              request.params.userId,
              status,
              request.body?.reason ?? null,
            ),
          request.txOpts(`users.${path}`),
        );
        return { ok: true };
      },
    );
  }

  app.post(
    '/:userId/reset-password',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'Reset password (temporary password returned once)',
        params: zUserId,
        response: { 200: zTempPwd },
      },
    },
    async (request) =>
      app.db.withTx(
        async (tx) => svc.resetPassword(tx, await actor(request, tx), request.params.userId),
        request.txOpts('users.reset-password'),
      ),
  );

  app.put(
    '/:userId/branches',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'Replace branches and roles',
        params: zUserId,
        body: zAccess,
        response: { 200: zAccessOut },
      },
    },
    async (request) =>
      app.db.withTx(
        async (tx) =>
          svc.setUserAccess(tx, await actor(request, tx), request.params.userId, request.body),
        request.txOpts('users.access'),
      ),
  );
}
