// Devices (API_SPEC §2 /devices/token, §3 /admin/devices; TASKS P3-01; PERMISSIONS P-6).
import { DEVICE_TYPES, P, zDeviceCreate, zDeviceTokenRequest, zDeviceUpdate } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import * as svc from './service.js';

const zDevice = z.object({
  deviceId: z.string(),
  brnch: z.number(),
  deviceType: z.enum(DEVICE_TYPES),
  deviceName: z.string(),
  config: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  lastSeenOn: z.date().nullable(),
  createdOn: z.date().nullable(),
});
const zWithSecret = z.object({
  device: zDevice,
  secret: z.string(),
  note: z.string(),
});
const zIdParams = z.object({ deviceId: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/) });
const ONCE = 'Shown once: enter it in the device (agent config / tablet setup) now.';

/** @param {import('fastify').FastifyInstance} app */
export default async function deviceRoutes(app) {
  const tags = ['devices'];
  const actor = (request) => ({ now: app.clock.now(), audit: request.ctx() });
  /** admin.devices in the device's own branch (P-1) */
  const mayManage = async (request, brnch) => {
    if (!(await request.authz.allowedBranches()).includes(brnch))
      throw Errors.branchForbidden(brnch);
    if (!(await request.authz.permissions(brnch)).has(P.admin.devices))
      throw Errors.forbidden(`You need ${P.admin.devices} in branch ${brnch}`);
  };

  app.post(
    '/devices/token',
    {
      config: { public: true, csrf: false, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary:
          'Device sign-in: { deviceId, ts, nonce, signature = HMAC(secret, "DCL-DEV|id|ts|nonce") } → token (12 h)',
        body: zDeviceTokenRequest,
        response: {
          200: z.object({
            token: z.string(),
            expiresIn: z.number(),
            brnch: z.number(),
            deviceType: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const res = await app.db.withTx(
        (tx) =>
          svc.issueToken(
            tx,
            request.ctx(),
            {
              encKey: app.config.APP_ENC_KEY,
              jwtSecret: app.config.JWT_SECRET,
              now: app.clock.now(),
            },
            request.body,
          ),
        {
          usrid: `DEV ${request.body.deviceId}`.slice(0, 20),
          action: 'devices.token',
          requestId: request.id,
        },
      );
      if (!res) throw Errors.unauthenticated('Device not recognised');
      return res;
    },
  );

  app.get(
    '/devices/me',
    {
      config: { device: true },
      schema: {
        tags,
        summary: 'The calling device: branch, type and its configuration (parser profile, port)',
        response: { 200: zDevice },
      },
    },
    async (request) => {
      if (!request.device) throw Errors.forbidden('Only for devices');
      return app.db.read(
        (tx) => svc.get(tx, request.device.deviceId),
        request.txOpts('devices.me'),
      );
    },
  );

  app.get(
    '/admin/devices',
    {
      config: { permission: P.admin.devices },
      schema: {
        tags,
        summary: 'Devices of my branches (brnch=all for every branch I administer)',
        querystring: z.object({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
        }),
        response: { 200: z.object({ items: z.array(zDevice) }) },
      },
    },
    async (request) => {
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.admin.devices),
        },
        request.query.brnch,
      );
      return {
        items: await app.db.read((tx) => svc.list(tx, branches), request.txOpts('devices.list')),
      };
    },
  );

  app.post(
    '/admin/devices',
    {
      config: { permission: P.admin.devices },
      schema: {
        tags,
        summary: 'Register a device; the secret is returned once',
        body: zDeviceCreate,
        response: { 201: zWithSecret },
      },
    },
    async (request, reply) => {
      await mayManage(request, request.body.brnch);
      const res = await app.db.withTx(
        (tx) => svc.create(tx, actor(request), app.config.APP_ENC_KEY, request.body),
        request.txOpts('devices.create'),
      );
      return reply.status(201).send({ ...res, note: ONCE });
    },
  );

  app.put(
    '/admin/devices/:deviceId',
    {
      config: { permission: P.admin.devices },
      schema: {
        tags,
        summary: 'Rename, switch on/off, change the configuration',
        params: zIdParams,
        body: zDeviceUpdate,
        response: { 200: zDevice },
      },
    },
    async (request) =>
      app.db.withTx(async (tx) => {
        const d = await svc.get(tx, request.params.deviceId);
        await mayManage(request, d.brnch);
        return svc.update(tx, actor(request), d.deviceId, request.body);
      }, request.txOpts('devices.update')),
  );

  app.post(
    '/admin/devices/:deviceId/rotate-secret',
    {
      config: { permission: P.admin.devices },
      schema: {
        tags,
        summary: 'New secret (returned once); the old one stops working at once',
        params: zIdParams,
        body: z.object({}).optional(),
        response: { 200: zWithSecret },
      },
    },
    async (request) => {
      const res = await app.db.withTx(async (tx) => {
        const d = await svc.get(tx, request.params.deviceId);
        await mayManage(request, d.brnch);
        return svc.rotateSecret(tx, actor(request), app.config.APP_ENC_KEY, d.deviceId);
      }, request.txOpts('devices.rotate'));
      return { ...res, note: ONCE };
    },
  );
}
