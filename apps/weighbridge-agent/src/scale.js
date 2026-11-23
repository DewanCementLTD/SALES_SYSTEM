// The live scale: frames → parsed readings → stable window (BR-WGT-01) → events. "Offline" when
// no valid frame arrived for `offlineMs` (PRD 4.10 AC: unplugged cable shows within 3 s).
import { EventEmitter } from 'node:events';
import { StableWindow } from '@dcl/shared';
import { makeFramer, makeParser } from './profiles.js';

export class Scale extends EventEmitter {
  /**
   * @param {{ parser: any, stable?: { count?: number, kg?: number }, offlineMs?: number,
   *   now?: () => Date }} opts
   */
  constructor({ parser, stable, offlineMs = 3000, now = () => new Date() }) {
    super();
    this.parse = makeParser(parser);
    this.window = new StableWindow(stable);
    this.offlineMs = offlineMs;
    this.now = now;
    this.online = false;
    this.last = null; // { kg, motion, stable, at, error? }
    this.watchdog = null;
    this.feed = makeFramer((f) => this.onFrame(f));
  }

  onFrame(frame) {
    const r = this.parse(frame);
    if (!r) return; // not a weight frame (headers, noise)
    this.touch();
    if ('error' in r) {
      this.window.reset();
      this.last = { kg: null, motion: true, stable: false, at: this.now(), error: r.error };
    } else {
      const stable = this.window.push(r);
      this.last = { kg: r.kg, motion: r.motion, stable, at: this.now() };
    }
    this.emit('reading', { ...this.last, online: true });
  }

  touch() {
    clearTimeout(this.watchdog);
    if (!this.online) {
      this.online = true;
      this.emit('online');
    }
    this.watchdog = setTimeout(() => {
      this.online = false;
      this.window.reset();
      this.emit('offline');
    }, this.offlineMs);
    this.watchdog.unref?.();
  }

  /** What a capture would take now, or why not. */
  captureable() {
    if (!this.online) return { ok: false, reason: 'The indicator is offline' };
    if (!this.last || this.last.error)
      return { ok: false, reason: `Indicator error ${this.last?.error ?? ''}`.trim() };
    if (!this.window.stable) return { ok: false, reason: 'The weight is not stable yet' };
    return { ok: true, weightKg: this.window.weightKg };
  }

  stop() {
    clearTimeout(this.watchdog);
  }
}
