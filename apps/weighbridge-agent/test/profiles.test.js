import { describe, expect, it } from 'vitest';
import { makeFramer, makeParser } from '../src/profiles.js';

describe('parser profiles (P3-02)', () => {
  it('st-gs: weight, motion, overload, sign', () => {
    const p = makeParser('st-gs');
    expect(p('ST,GS,+0041250kg')).toEqual({ kg: 41250, motion: false });
    expect(p('US,GS,+0041180kg')).toEqual({ kg: 41180, motion: true });
    expect(p('ST,NT,-0000020kg')).toEqual({ kg: -20, motion: false });
    expect(p('OL,GS,+9999999kg')).toEqual({ error: 'OL' });
    expect(p('HELLO')).toBeNull();
  });

  it('digits and a custom profile in tonnes', () => {
    expect(makeParser('digits')('+041250')).toEqual({ kg: 41250, motion: false });
    expect(makeParser('digits')('41250 kg')).toEqual({ kg: 41250, motion: false });
    const t = makeParser({
      regex: '^W:(?<kg>\\d+\\.\\d+)T(?<status>[SM])$',
      motion: ['M'],
      unit: 't',
    });
    expect(t('W:41.250TS')).toEqual({ kg: 41250, motion: false });
    expect(t('W:41.250TM')).toEqual({ kg: 41250, motion: true });
    expect(() => makeParser('nope')).toThrow(/Unknown parser/);
  });

  it('framer: CR/LF/ETX end frames, STX dropped, partial chunks joined', () => {
    const out = [];
    const feed = makeFramer((f) => out.push(f));
    feed('ST,GS,+00412');
    feed('50kg\r\n\x02ST,GS,+0041251kg\x03US,');
    feed(Buffer.from('GS,+0041100kg\n'));
    expect(out).toEqual(['ST,GS,+0041250kg', 'ST,GS,+0041251kg', 'US,GS,+0041100kg']);
  });
});
