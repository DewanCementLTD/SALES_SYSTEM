// Oracle access: pool, one-transaction-per-command (`withTx`), typed fetch rules.
// SQL must run on 11g and 19c (CLAUDE.md rule 2). Bind variables only (rule 4).
import oracledb from 'oracledb';
import knexFactory from 'knex';
import { AppError } from '../errors.js';

let clientInitialised = false;

/**
 * One-time driver set-up. Thick mode (Instant Client) is needed for 11g; Thin works for 12.1+.
 * @param {{ ORACLE_CLIENT_MODE: 'thick'|'thin', ORACLE_LIB_DIR?: string }} cfg
 */
export function initOracleClient(cfg) {
  if (clientInitialised) return;
  // Business time zone for DATE conversion (client side) and session (server side).
  process.env.TZ = process.env.TZ || 'Asia/Karachi';
  process.env.ORA_SDTZ = process.env.ORA_SDTZ || '+05:00';
  if (cfg.ORACLE_CLIENT_MODE === 'thick') {
    oracledb.initOracleClient(cfg.ORACLE_LIB_DIR ? { libDir: cfg.ORACLE_LIB_DIR } : undefined);
  }
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  // Decimal NUMBER columns (money, tons) come back as strings → wrap in Decimal; integers stay numbers.
  // CLOBs come back as strings (JSON text, payloads).
  oracledb.fetchTypeHandler = (meta) => {
    if (meta.dbType === oracledb.DB_TYPE_NUMBER && (meta.scale > 0 || meta.precision > 15)) {
      return { type: oracledb.STRING };
    }
    if (meta.dbType === oracledb.DB_TYPE_CLOB) return { type: oracledb.STRING };
    return undefined;
  };
  clientInitialised = true;
}

/** SQL builder only (no connection): `qb('APP_USER').where(...)`, run with `tx.run(builder)`. */
export const qb = knexFactory({ client: 'oracledb' });

const SEQ_NAME = /^SEQ_[A-Z0-9_]{1,26}$/;

/** A connection inside one transaction. Repos receive this; they never commit. */
export class Tx {
  /** @param {import('oracledb').Connection} conn */
  constructor(conn) {
    this.conn = conn;
  }

  /** Raw execute with binds. */
  execute(sql, binds = {}, opts = {}) {
    return this.conn.execute(sql, binds, { autoCommit: false, ...opts });
  }

  /** @returns {Promise<Record<string, any>[]>} */
  async many(sql, binds = {}, opts = {}) {
    const r = await this.execute(sql, binds, opts);
    return r.rows ?? [];
  }

  /** First row or null. */
  async one(sql, binds = {}, opts = {}) {
    const rows = await this.many(sql, binds, { ...opts, maxRows: 1 });
    return rows[0] ?? null;
  }

  /** Rows affected by DML. */
  async exec(sql, binds = {}, opts = {}) {
    const r = await this.execute(sql, binds, opts);
    return r.rowsAffected ?? 0;
  }

  /** Insert many rows with one round trip. */
  async execMany(sql, rows, opts = {}) {
    if (!rows.length) return 0;
    const r = await this.conn.executeMany(sql, rows, { autoCommit: false, ...opts });
    return r.rowsAffected ?? 0;
  }

  /** Technical id of a NEW table from its sequence (never for document numbers, BR-NUM-01). */
  async nextId(seqName) {
    if (!SEQ_NAME.test(seqName)) throw new Error(`Bad sequence name ${seqName}`);
    const row = await this.one(`SELECT ${seqName}.NEXTVAL AS ID FROM DUAL`);
    return Number(row.ID);
  }

  /** Run a knex builder (SQL generation only) with native binds. */
  async run(builder) {
    const { sql, bindings } = builder.toSQL().toNative();
    const r = await this.execute(sql, bindings);
    return r.rows ?? r.rowsAffected;
  }
}

export class Db {
  /** @param {import('oracledb').Pool} pool */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Run `fn` in one transaction: commit when it resolves, roll back when it throws.
   * `ctx` tags the session for DBA tracing (CLIENT_IDENTIFIER / MODULE / ACTION).
   * `ctx.rollback = true` always rolls back (read-only work and integration tests).
   * @template T
   * @param {(tx: Tx) => Promise<T>} fn
   * @param {{ usrid?: string, action?: string, requestId?: string, rollback?: boolean }} [ctx]
   * @returns {Promise<T>}
   */
  async withTx(fn, ctx = {}) {
    const conn = await this.pool.getConnection();
    try {
      conn.clientId = (ctx.usrid ?? 'anonymous').slice(0, 64);
      conn.module = 'dcl-api';
      conn.action = (ctx.action ?? '').slice(0, 32);
      conn.clientInfo = (ctx.requestId ?? '').slice(0, 64);
      const result = await fn(new Tx(conn));
      if (ctx.rollback) await conn.rollback();
      else await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw translateOracleError(err);
    } finally {
      await conn.close().catch(() => {});
    }
  }

  /** Read-only unit of work (always rolled back). */
  read(fn, ctx = {}) {
    return this.withTx(fn, { ...ctx, rollback: true });
  }

  async ping() {
    return this.read(async (tx) => {
      const r = await tx.one('SELECT 1 AS OK FROM DUAL');
      return r?.OK === 1;
    });
  }

  async close(drainSeconds = 5) {
    await this.pool.close(drainSeconds);
  }
}

/**
 * @param {import('../../config.js').AppConfig} cfg
 * @returns {Promise<Db>}
 */
export async function createDb(cfg) {
  initOracleClient(cfg);
  // Thick mode runs each call on a libuv worker thread. With fewer threads than connections,
  // sessions waiting on a row lock (FOR UPDATE) can starve the lock holder's commit → deadlock.
  if (cfg.ORACLE_CLIENT_MODE === 'thick') {
    const threads = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
    if (threads < cfg.DB_POOL_MAX + 4) {
      throw new Error(
        `UV_THREADPOOL_SIZE (${threads}) must be at least DB_POOL_MAX + 4 (${cfg.DB_POOL_MAX + 4}) in Thick mode. Set it in .env.`,
      );
    }
  }
  const pool = await oracledb.createPool({
    user: cfg.DATABASE_USER,
    password: cfg.DATABASE_PASSWORD,
    connectString: cfg.DATABASE_CONNECT_STRING,
    poolMin: cfg.DB_POOL_MIN,
    poolMax: cfg.DB_POOL_MAX,
    poolIncrement: 2,
    stmtCacheSize: 50,
    queueTimeout: 30_000,
  });
  return new Db(pool);
}

/** Map Oracle errors that have a business meaning; leave the rest untouched. */
export function translateOracleError(err) {
  if (err instanceof AppError) return err;
  const num = err?.errorNum;
  if (num === 1) {
    return new AppError('duplicate', 409, 'A record with the same key already exists', {
      cause: err,
    });
  }
  if (num === 54 || num === 30006) {
    return new AppError('busy', 409, 'The record is being changed by another user. Try again.', {
      cause: err,
    });
  }
  return err;
}

/** `{ USER_ID: 1, FULL_NAME: 'x' }` → `{ userId: 1, fullName: 'x' }` */
export function camelRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}
