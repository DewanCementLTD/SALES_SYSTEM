// The weighbridge agent (ARCHITECTURE §6.4, PRD 4.10, TASKS P3-02): reads the indicator, keeps the
// stable state (BR-WGT-01), serves the weighing screen on ws://127.0.0.1:7071, and on "capture"
// signs the stable weight with the device secret, stores it and uploads it (retrying while the
// API is unreachable).
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { deviceHmac, readingText } from '@dcl/shared';
import { Scale } from './scale.js';
import { makeSource } from './sources.js';

export class Agent extends EventEmitter {
  /**
   * @param {{ deviceId: string, secret: string, source: any, parser: any, stable?: any,
   *   offlineMs?: number, retryMs?: number }} cfg
   * @param {{ api: import('./api-client.js').ApiClient, store: import('./store.js').AgentStore,
   *   log?: any, now?: () => Date, source?: any }} deps
   */
  constructor(cfg, { api, store, log, now = () => new Date(), source }) {
    super();
    this.cfg = cfg;
    this.api = api;
    this.store = store;
    this.log = log;
    this.now = now;
    this.apiOnline = null;
    this.scale = new Scale({
      parser: cfg.parser,
      stable: cfg.stable,
      offlineMs: cfg.offlineMs,
      now,
    });
    this.source = source ?? makeSource(cfg.source, log);
    this.scale.on('reading', (r) => this.emit('reading', r));
    this.scale.on('online', () => this.emit('status', this.status()));
    this.scale.on('offline', () => {
      log?.warn('indicator offline');
      this.emit('status', this.status());
    });
    this.retry = null;
    this.flushing = null;
  }

  start() {
    this.source.start((chunk) => this.scale.feed(chunk));
    const every = this.cfg.retryMs ?? 10000;
    this.retry = setInterval(() => {
      this.flush().catch(() => {});
    }, every);
    this.retry.unref?.();
    this.flush().catch(() => {});
  }

  stop() {
    clearInterval(this.retry);
    this.source.stop();
    this.scale.stop();
  }

  status() {
    return {
      deviceId: this.cfg.deviceId,
      indicatorOnline: this.scale.online,
      apiOnline: this.apiOnline,
      source: this.source.name,
      ...this.store.counts(),
    };
  }

  /**
   * Capture the current stable weight: sign, store, try to upload. Throws when not stable /
   * offline (BR-WGT-01: only stable readings).
   */
  async capture() {
    const c = this.scale.captureable();
    if (!c.ok) throw new Error(c.reason);
    const r = {
      deviceId: this.cfg.deviceId,
      readingId: randomUUID(),
      weightKg: c.weightKg,
      stable: true,
      readOn: this.now().toISOString(),
    };
    const body = { ...r, signature: await deviceHmac(this.cfg.secret, readingText(r)) };
    this.store.add(body, this.now());
    this.log?.info({ readingId: r.readingId, weightKg: r.weightKg }, 'captured');
    await this.flush().catch(() => {});
    const uploaded = this.store.pending(1000).every((p) => p.readingId !== r.readingId);
    return { ...r, uploaded };
  }

  /** Upload what is waiting, oldest first (one run at a time). */
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await null; // run after the assignment, so `finally` clears the current run
      try {
        for (const body of this.store.pending(50)) {
          let res;
          try {
            res = await this.api.uploadReading(body);
          } catch (e) {
            this.setApiOnline(false, e.message);
            this.store.error(body.readingId, e.message, false);
            return;
          }
          this.setApiOnline(true);
          if (res.ok) this.store.uploaded(body.readingId, this.now());
          else {
            this.log?.warn({ readingId: body.readingId, err: res.message }, 'upload refused');
            this.store.error(body.readingId, res.message, res.permanent);
            if (!res.permanent) return;
          }
        }
      } finally {
        this.flushing = null;
        this.emit('status', this.status());
      }
    })();
    return this.flushing;
  }

  setApiOnline(on, why) {
    if (this.apiOnline !== on) {
      this.apiOnline = on;
      if (!on) this.log?.warn({ err: why }, 'API not reachable; readings are kept and retried');
      this.emit('status', this.status());
    }
  }
}
