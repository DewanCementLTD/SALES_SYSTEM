// Where frames come from: the serial port (COM), a TCP indicator/converter, or the simulator
// (dev/test, PRD 4.10 AC). Each source calls onData(chunk) and reconnects by itself.
import net from 'node:net';

/**
 * Simulator: an empty bridge, a truck driving on, settling with a little noise, staying, leaving.
 * Frames in the "st-gs" format every `intervalMs`.
 */
export function simulatorSource({
  intervalMs = 200,
  emptyKg = 0,
  loadKg = 41250,
  noiseKg = 3,
} = {}) {
  let timer = null;
  let tick = 0;
  const cycle = 200; // ticks per truck
  const weightAt = (t) => {
    const i = t % cycle;
    if (i < 20) return { kg: emptyKg, motion: false };
    if (i < 40)
      return { kg: Math.round(emptyKg + ((loadKg - emptyKg) * (i - 20)) / 20), motion: true };
    if (i < 160)
      return { kg: loadKg + Math.round((Math.random() * 2 - 1) * noiseKg), motion: i < 45 };
    if (i < 180)
      return { kg: Math.round(loadKg - ((loadKg - emptyKg) * (i - 160)) / 20), motion: true };
    return { kg: emptyKg, motion: false };
  };
  return {
    name: 'simulator',
    start(onData) {
      timer = setInterval(() => {
        const w = weightAt(tick);
        tick += 1;
        const sign = w.kg < 0 ? '-' : '+';
        onData(
          `${w.motion ? 'US' : 'ST'},GS,${sign}${String(Math.abs(w.kg)).padStart(7, '0')}kg\r\n`,
        );
      }, intervalMs);
    },
    stop() {
      clearInterval(timer);
    },
  };
}

/** TCP client (serial-to-Ethernet converters, networked indicators); reconnects every 3 s. */
export function tcpSource({ host, port }, log) {
  let sock = null;
  let stopped = false;
  let retry = null;
  const connect = (onData) => {
    sock = net.connect({ host, port });
    sock.setKeepAlive(true, 5000);
    sock.on('data', onData);
    sock.on('error', (e) => log?.warn({ err: e.message }, 'indicator TCP error'));
    sock.on('close', () => {
      if (!stopped) retry = setTimeout(() => connect(onData), 3000);
    });
  };
  return {
    name: `tcp ${host}:${port}`,
    start(onData) {
      connect(onData);
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      sock?.destroy();
    },
  };
}

/** Serial port (COMn). `serialport` is loaded only here (native module, optional dependency). */
export function serialSource(
  { path, baudRate = 9600, dataBits = 8, parity = 'none', stopBits = 1 },
  log,
) {
  let port = null;
  let stopped = false;
  let retry = null;
  const open = async (onData) => {
    const { SerialPort } = await import('serialport');
    port = new SerialPort({ path, baudRate, dataBits, parity, stopBits, autoOpen: false });
    port.on('data', onData);
    port.on('error', (e) => log?.warn({ err: e.message }, 'serial port error'));
    port.on('close', () => {
      if (!stopped) retry = setTimeout(() => open(onData).catch(() => {}), 3000);
    });
    port.open((err) => {
      if (err) {
        log?.warn({ err: err.message, path }, 'cannot open the serial port');
        if (!stopped) retry = setTimeout(() => open(onData).catch(() => {}), 3000);
      }
    });
  };
  return {
    name: `serial ${path}@${baudRate}`,
    start(onData) {
      open(onData).catch((e) => log?.error({ err: e.message }, 'serialport module not available'));
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      if (port?.isOpen) port.close();
    },
  };
}

/** @param {{ type: 'simulator'|'tcp'|'serial', [k: string]: any }} cfg */
export function makeSource(cfg, log) {
  if (cfg.type === 'tcp') return tcpSource(cfg, log);
  if (cfg.type === 'serial') return serialSource(cfg, log);
  if (cfg.type === 'simulator') return simulatorSource(cfg);
  throw new Error(`Unknown source type ${cfg.type}`);
}
