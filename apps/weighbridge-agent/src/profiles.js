// Indicator frame parsing (PRD 4.10, TASKS P3-02). A profile is a regular expression with named
// groups: `kg` (required, the number), `sign` (+/-), `status` (stable/motion/overload code).
// Indicators differ per site, so the profile is configurable on the device (Admin › Devices,
// config.profile = name, or config.parser = { regex, motion, error, unit }). The built-in ones
// cover the usual continuous outputs; check the indicator manual and adjust on site.

export const PROFILES = Object.freeze({
  // "ST,GS,+0041250kg": status ST = stable, US = unstable (motion), OL = overload; GS/NT/TR mode.
  // Continuous output of many indicators (A&D-style, XK3190 family in "ST/US" mode).
  'st-gs': {
    regex: '^(?<status>ST|US|OL),(?:GS|NT|TR),(?<sign>[+-])?\\s*(?<kg>\\d+(?:\\.\\d+)?)\\s*(?:kg)?',
    motion: ['US'],
    error: ['OL'],
    unit: 'kg',
  },
  // Plain number per frame, optional sign and unit: "+041250", "41250 kg". No motion flag: the
  // agent's own stable rule decides (BR-WGT-01).
  digits: {
    regex: '^(?<sign>[+-])?\\s*(?<kg>\\d{1,7}(?:\\.\\d+)?)\\s*(?:kg)?\\s*$',
    motion: [],
    error: [],
    unit: 'kg',
  },
  // Built-in simulator (same format as st-gs).
  simulator: {
    regex: '^(?<status>ST|US|OL),(?:GS|NT|TR),(?<sign>[+-])?\\s*(?<kg>\\d+(?:\\.\\d+)?)\\s*(?:kg)?',
    motion: ['US'],
    error: ['OL'],
    unit: 'kg',
  },
});

/**
 * @param {string|{ regex: string, motion?: string[], error?: string[], unit?: 'kg'|'t' }} spec
 *   a profile name or a custom parser
 * @returns {(frame: string) => ({ kg: number, motion: boolean } | { error: string } | null)}
 */
export function makeParser(spec) {
  const p = typeof spec === 'string' ? PROFILES[spec] : spec;
  if (!p?.regex) throw new Error(`Unknown parser profile ${JSON.stringify(spec)}`);
  const re = new RegExp(p.regex);
  const factor = p.unit === 't' ? 1000 : 1;
  const motion = new Set(p.motion ?? []);
  const error = new Set(p.error ?? []);
  return (frame) => {
    const m = re.exec(String(frame).trim());
    if (!m?.groups?.kg) return null;
    const status = m.groups.status ?? '';
    if (error.has(status)) return { error: status };
    const value = Number(m.groups.kg) * factor * (m.groups.sign === '-' ? -1 : 1);
    if (!Number.isFinite(value)) return null;
    return { kg: Math.round(value), motion: motion.has(status) };
  };
}

const STX = String.fromCharCode(2);
const ETX = String.fromCharCode(3);

/**
 * Splits a byte/text stream into frames (CR, LF, CRLF or ETX end a frame; STX is dropped).
 * @param {(frame: string) => void} onFrame
 */
export function makeFramer(onFrame, { maxLength = 256 } = {}) {
  let buf = '';
  return (chunk) => {
    buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1');
    const parts = buf
      .split(ETX)
      .join('\n')
      .split(/\r\n|\r|\n/);
    buf = parts.pop() ?? '';
    if (buf.length > maxLength) buf = ''; // garbage without delimiters: drop it
    for (const p of parts) {
      const f = p.split(STX).join('').trim();
      if (f) onFrame(f);
    }
  };
}
