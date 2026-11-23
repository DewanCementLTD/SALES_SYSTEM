import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scale } from '../src/scale.js';
import { AgentStore } from '../src/store.js';

afterEach(() => vi.useRealTimers());

describe('scale (BR-WGT-01, PRD 4.10)', () => {
  it('BR-WGT-01: stable after 5 close readings; capture refused while moving; offline after 3 s', () => {
    vi.useFakeTimers();
    const s = new Scale({ parser: 'st-gs' });
    const events = [];
    s.on('offline', () => events.push('offline'));
    s.on('online', () => events.push('online'));
    s.feed('US,GS,+0030000kg\r\n');
    expect(s.captureable()).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not stable/),
    });
    for (const kg of [41250, 41252, 41249, 41251, 41250]) s.feed(`ST,GS,+00${kg}kg\r\n`);
    expect(s.captureable()).toEqual({ ok: true, weightKg: 41250 });
    vi.advanceTimersByTime(3100);
    expect(events).toEqual(['online', 'offline']);
    expect(s.captureable()).toMatchObject({ ok: false, reason: expect.stringMatching(/offline/) });
    s.stop();
  });

  it('an overload frame resets the run', () => {
    const s = new Scale({ parser: 'st-gs', stable: { count: 3, kg: 5 } });
    for (const kg of [100, 100, 100]) s.feed(`ST,GS,+${kg}kg\r\n`);
    expect(s.captureable().ok).toBe(true);
    s.feed('OL,GS,+9999999kg\r\n');
    expect(s.captureable()).toMatchObject({ ok: false, reason: expect.stringMatching(/OL/) });
    s.stop();
  });
});

describe('agent store', () => {
  it('pending → uploaded; a refused reading stops being retried; config cache', () => {
    const st = new AgentStore(':memory:');
    st.add({ readingId: 'a1', weightKg: 1 }, new Date('2026-11-24T05:00:00Z'));
    st.add({ readingId: 'a2', weightKg: 2 }, new Date('2026-11-24T05:00:01Z'));
    st.add({ readingId: 'a1', weightKg: 1 }); // same id again: ignored
    expect(st.pending().map((r) => r.readingId)).toEqual(['a1', 'a2']);
    st.uploaded('a1');
    st.error('a2', '409 duplicate', true);
    expect(st.pending()).toEqual([]);
    expect(st.counts()).toEqual({ pending: 0, failed: 1 });
    st.set('deviceConfig', { source: { type: 'simulator' } });
    expect(st.get('deviceConfig')).toEqual({ source: { type: 'simulator' } });
    st.close();
  });
});
