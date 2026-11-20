// /api/v1/masters/* and /api/v1/lookups (API_SPEC §4, TASKS P1-01).
// The body of create/update depends on the master type, so it is validated in the handler with the
// registry schema from @dcl/shared (same Zod rules the web forms use).
import { MASTER_TYPES, P, parseMasterKey, masterBodySchema, zBrnch, zPageQuery } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { etag, ifMatch } from '../../lib/http.js';
import * as repo from './repo.js';
import * as svc from './service.js';

const zType = z.enum(/** @type {[string, ...string[]]} */ (MASTER_TYPES));
const zRow = z
  .object({
    brnch: z.number(),
    active: z.boolean(),
    rowVer: z.number(),
    updatedBy: z.string().nullable(),
    updatedOn: z.date().nullable(),
  })
  .catchall(z.unknown());
const zParams = z.object({ type: zType, brnch: zBrnch, key: z.string().min(1).max(80) });
const zFieldErrors = (issues, prefix) =>
  issues.map((i) => ({ path: [prefix, ...i.path].join('.'), message: i.message }));

/** Validate a type-specific body. */
function parseBody(def, mode, body) {
  const r = masterBodySchema(def, mode).safeParse(body ?? {});
  if (!r.success)
    throw Errors.validation(
      'Please correct the marked fields',
      zFieldErrors(r.error.issues, 'body'),
    );
  return r.data;
}

function parseKey(def, raw) {
  const key = parseMasterKey(def, raw);
  if (!key) throw Errors.notFound(def.singular);
  return key;
}

/** @param {import('fastify').FastifyInstance} app */
export default async function masterRoutes(app) {
  const tags = ['masters'];
  const lookupCache = svc.createLookupCache();
  const actor = (request) => ({
    usrid: request.session.usrid,
    audit: request.ctx(),
    now: app.clock.now(),
    lookupCache,
  });

  app.get(
    '/masters/:type',
    {
      config: { permission: P.masters.view },
      schema: {
        tags,
        summary: 'List a master (branch-scoped; brnch=all for every allowed branch)',
        params: z.object({ type: zType }),
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          active: z.enum(['true', 'false']).optional(),
          productCode: z.string().trim().max(4).optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zRow),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const def = svc.masterDef(request.params.type);
      const { brnch, active, productCode, ...page } = request.query;
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.masters.view),
        },
        brnch,
      );
      const filters = {};
      if (productCode && def.key.some((k) => k.name === 'productCode'))
        filters.productCode = productCode.toUpperCase();
      return app.db.read(
        (tx) =>
          repo.list(tx, def, {
            branches,
            active: active === undefined ? undefined : active === 'true',
            filters,
            ...page,
          }),
        request.txOpts('masters.list'),
      );
    },
  );

  app.get(
    '/masters/:type/:brnch/:key',
    {
      config: { permission: P.masters.view },
      schema: {
        tags,
        summary: 'One master record (ETag = row version)',
        params: zParams,
        response: { 200: zRow },
      },
    },
    async (request, reply) => {
      const def = svc.masterDef(request.params.type);
      const key = parseKey(def, request.params.key);
      const row = await app.db.read(
        (tx) => repo.get(tx, def, request.params.brnch, key),
        request.txOpts('masters.get'),
      );
      if (!row) throw Errors.notFound(def.singular);
      reply.header('etag', etag(row.rowVer));
      return row;
    },
  );

  app.post(
    '/masters/:type',
    {
      config: { permission: P.masters.create },
      schema: {
        tags,
        summary: 'Create a master record in a branch (fields per type, see @dcl/shared masters.js)',
        params: z.object({ type: zType }),
        body: z.object({ brnch: zBrnch.optional() }).catchall(z.unknown()),
        response: { 201: zRow },
      },
    },
    async (request, reply) => {
      const def = svc.masterDef(request.params.type);
      const { brnch = request.session.brnch, ...rest } = request.body;
      const values = parseBody(def, 'create', rest);
      const row = await app.db.withTx(
        (tx) => svc.createMaster(tx, actor(request), def, brnch, values),
        request.txOpts('masters.create'),
      );
      reply.header('etag', etag(row.rowVer));
      return reply.status(201).send(row);
    },
  );

  app.put(
    '/masters/:type/:brnch/:key',
    {
      config: { permission: P.masters.update },
      schema: {
        tags,
        summary: 'Update a master record (If-Match required; key cannot change)',
        params: zParams,
        body: z.object({}).catchall(z.unknown()),
        response: { 200: zRow },
      },
    },
    async (request, reply) => {
      const def = svc.masterDef(request.params.type);
      const key = parseKey(def, request.params.key);
      const ver = ifMatch(request);
      const values = parseBody(def, 'update', request.body);
      const row = await app.db.withTx(
        (tx) => svc.updateMaster(tx, actor(request), def, request.params.brnch, key, ver, values),
        request.txOpts('masters.update'),
      );
      reply.header('etag', etag(row.rowVer));
      return row;
    },
  );

  for (const [cmd, active] of [
    ['deactivate', false],
    ['activate', true],
  ]) {
    app.post(
      `/masters/:type/:brnch/:key/${cmd}`,
      {
        config: { permission: P.masters.update },
        schema: {
          tags,
          summary: `${cmd === 'activate' ? 'Activate' : 'Deactivate (never delete)'} a master record (If-Match)`,
          params: zParams,
          body: z.object({ reason: z.string().trim().max(1000).optional() }).optional(),
          response: { 200: zRow },
        },
      },
      async (request, reply) => {
        const def = svc.masterDef(request.params.type);
        const key = parseKey(def, request.params.key);
        const ver = ifMatch(request);
        const row = await app.db.withTx(
          (tx) =>
            svc.setMasterActive(
              tx,
              actor(request),
              def,
              request.params.brnch,
              key,
              ver,
              active,
              request.body?.reason,
            ),
          request.txOpts(`masters.${cmd}`),
        );
        reply.header('etag', etag(row.rowVer));
        return row;
      },
    );
  }

  app.get(
    '/lookups',
    {
      schema: {
        tags,
        summary: 'Value/label lists for pickers (current branch, cached 5 min)',
        querystring: z.object({
          types: z
            .string()
            .max(500)
            .transform((s) => [
              ...new Set(
                s
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              ),
            ])
            .pipe(
              z
                .array(z.enum(/** @type {[string, ...string[]]} */ (svc.LOOKUP_TYPES)))
                .min(1)
                .max(20),
            ),
          brnch: z.coerce.number().int().optional(),
        }),
        response: {
          200: z.record(
            z.string(),
            z.array(z.object({ value: z.string(), label: z.string(), active: z.boolean() })),
          ),
        },
      },
    },
    async (request) => {
      const brnch = request.query.brnch ?? request.session.brnch;
      if (!(await request.authz.allowedBranches()).includes(brnch))
        throw Errors.branchForbidden(brnch);
      return app.db.read(
        (tx) => svc.lookups(tx, brnch, request.query.types, app.clock.now().getTime(), lookupCache),
        request.txOpts('lookups'),
      );
    },
  );
}
