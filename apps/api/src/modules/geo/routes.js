// /api/v1/geo/* (API_SPEC §4 Geography, TASKS P1-02).
import { P, zBrnch, zGeoCreate, zGeoRename, zPageQuery } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { etag, ifMatch } from '../../lib/http.js';
import * as repo from './repo.js';
import * as svc from './service.js';

const zGeoCode = z
  .string()
  .max(50)
  .regex(/^Z[A-Z0-9]+(-[TAC][A-Z0-9]+){0,3}$/, 'Not a geography code');
const zNode = z.object({
  geoId: z.number(),
  brnch: z.number(),
  geoCode: z.string(),
  level: z.number(),
  code: z.string(),
  name: z.string(),
  path: z.array(z.string().nullable()),
  sourceTable: z.string(),
  legacyCode: z.string().nullable(),
  active: z.boolean(),
  rowVer: z.number(),
  updatedBy: z.string().nullable(),
  updatedOn: z.date().nullable(),
  childCount: z.number(),
  customerCount: z.number(),
});
const zPageOf = (item) =>
  z.object({ items: z.array(item), page: z.number(), pageSize: z.number(), total: z.number() });
const zBrnchQuery = z.union([z.literal('all'), z.coerce.number().int()]).optional();
const zNodeParams = z.object({ brnch: zBrnch, geoCode: zGeoCode });

/** @param {import('fastify').FastifyInstance} app */
export default async function geoRoutes(app) {
  const tags = ['geography'];
  const actor = (request) => ({
    usrid: request.session.usrid,
    audit: request.ctx(),
    now: app.clock.now(),
  });
  const branchesFor = async (request, requested) =>
    resolveListBranches(
      {
        brnch: request.session.brnch,
        allowedBranches: await request.authz.branchesWith(P.masters.view),
      },
      requested,
    );

  app.get(
    '/geo/nodes',
    {
      config: { permission: P.masters.view },
      schema: {
        tags,
        summary: 'Geography nodes: children of parentCode, or one level, or a search',
        querystring: zPageQuery.extend({
          brnch: zBrnchQuery,
          parentCode: zGeoCode.optional(),
          level: z.coerce.number().int().min(1).max(4).optional(),
          active: z.enum(['true', 'false']).optional(),
        }),
        response: { 200: zPageOf(zNode) },
      },
    },
    async (request) => {
      const { brnch, active, ...rest } = request.query;
      const branches = await branchesFor(request, brnch);
      return app.db.read(
        (tx) =>
          repo.listNodes(tx, {
            branches,
            active: active === undefined ? undefined : active === 'true',
            ...rest,
          }),
        request.txOpts('geo.list'),
      );
    },
  );

  app.get(
    '/geo/nodes/:brnch/:geoCode',
    {
      config: { permission: P.masters.view },
      schema: { tags, summary: 'One node (ETag)', params: zNodeParams, response: { 200: zNode } },
    },
    async (request, reply) => {
      const { brnch, geoCode } = request.params;
      const node = await app.db.read(
        (tx) => repo.getNode(tx, brnch, geoCode),
        request.txOpts('geo.get'),
      );
      if (!node) throw Errors.notFound('Geography node');
      reply.header('etag', etag(node.rowVer));
      return node;
    },
  );

  app.post(
    '/geo/nodes',
    {
      config: { permission: P.masters.create },
      schema: {
        tags,
        summary: 'Create a zone (no parent) or a child of parentCode; the code is fixed afterwards',
        body: zGeoCreate.extend({ brnch: zBrnch.optional() }),
        response: { 201: zNode },
      },
    },
    async (request, reply) => {
      const { brnch = request.session.brnch, ...body } = request.body;
      const node = await app.db.withTx(
        (tx) => svc.createNode(tx, actor(request), brnch, body),
        request.txOpts('geo.create'),
      );
      reply.header('etag', etag(node.rowVer));
      return reply.status(201).send(node);
    },
  );

  app.put(
    '/geo/nodes/:brnch/:geoCode',
    {
      config: { permission: P.masters.update },
      schema: {
        tags,
        summary: 'Rename a node (If-Match); the name is copied to all nodes below it',
        params: zNodeParams,
        body: zGeoRename,
        response: { 200: zNode },
      },
    },
    async (request, reply) => {
      const { brnch, geoCode } = request.params;
      const ver = ifMatch(request);
      const node = await app.db.withTx(
        (tx) => svc.renameNode(tx, actor(request), brnch, geoCode, ver, request.body.name),
        request.txOpts('geo.rename'),
      );
      reply.header('etag', etag(node.rowVer));
      return node;
    },
  );

  for (const [cmd, active] of [
    ['deactivate', false],
    ['activate', true],
  ]) {
    app.post(
      `/geo/nodes/:brnch/:geoCode/${cmd}`,
      {
        config: { permission: P.masters.update },
        schema: {
          tags,
          summary:
            cmd === 'deactivate'
              ? 'Deactivate a node and everything below it (If-Match)'
              : 'Activate a node (parent must be active; children stay as they are)',
          params: zNodeParams,
          body: z.object({ reason: z.string().trim().max(1000).optional() }).optional(),
          response: { 200: zNode.extend({ descendantsChanged: z.number() }) },
        },
      },
      async (request, reply) => {
        const { brnch, geoCode } = request.params;
        const ver = ifMatch(request);
        const node = await app.db.withTx(
          (tx) =>
            svc.setActive(tx, actor(request), brnch, geoCode, ver, active, request.body?.reason),
          request.txOpts(`geo.${cmd}`),
        );
        reply.header('etag', etag(node.rowVer));
        return node;
      },
    );
  }

  app.get(
    '/geo/legacy-map',
    {
      config: { permission: P.masters.view },
      schema: {
        tags,
        summary: 'Legacy geography code → new GEO_CODE (review)',
        querystring: zPageQuery.extend({
          brnch: zBrnchQuery,
          entity: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z_]{1,30}$/)
            .optional(),
        }),
        response: {
          200: zPageOf(
            z.object({
              brnch: z.number(),
              entity: z.string(),
              legacyCode: z.string(),
              newCode: z.string(),
              sourceDb: z.string(),
              mapDate: z.date().nullable(),
              level: z.number().nullable(),
              path: z.array(z.string().nullable()),
              nodeActive: z.boolean().nullable(),
              found: z.boolean(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const { brnch, ...rest } = request.query;
      const branches = await branchesFor(request, brnch);
      return app.db.read(
        (tx) => repo.listLegacyMap(tx, { branches, ...rest }),
        request.txOpts('geo.legacy'),
      );
    },
  );

  app.get(
    '/geo/summary',
    {
      config: { permission: P.masters.view },
      schema: {
        tags,
        summary: 'Nodes per level, customers without a geography, legacy map entities',
        querystring: z.object({ brnch: z.coerce.number().int().optional() }),
        response: {
          200: z.object({
            brnch: z.number(),
            levels: z.array(z.object({ level: z.number(), total: z.number(), active: z.number() })),
            customers: z.object({ total: z.number(), unplaced: z.number() }),
            legacyEntities: z.array(z.object({ entity: z.string(), count: z.number() })),
          }),
        },
      },
    },
    async (request) => {
      const brnch = request.query.brnch ?? request.session.brnch;
      return app.db.read((tx) => repo.summary(tx, brnch), request.txOpts('geo.summary'));
    },
  );
}
