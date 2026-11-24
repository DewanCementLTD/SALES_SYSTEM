# Weighbridge agent

Runs on the PC beside the weighbridge indicator (TASKS P3-02, PRD 4.10, ARCHITECTURE §6.4).

- Reads the indicator over a **serial port** (COM), **TCP** (serial-to-Ethernet converter or networked indicator) or the built-in **simulator**.
- Parses each frame with a **parser profile** (a regular expression) and decides whether the weight is **stable**: `count` consecutive readings within `kg` (BR-WGT-01, default 5 within 10 kg).
- Serves the weighing screen on **`ws://127.0.0.1:7071`**: live digits, STABLE, indicator online/offline (offline after 3 s without data).
- On **Capture** from the screen it takes the stable weight, signs it with the device secret (HMAC-SHA256) and uploads it to `POST /api/v1/plant/weigh-readings`. While the API is unreachable, captures stay in a local SQLite file and are retried every 10 s. The screen then uses the reading id for the tare or gross.

## Install

1. In the web app, **Admin › Devices › Register device**: id (e.g. `KHI-WB-01`), type _Weighbridge agent_, and the configuration JSON (below). Copy the secret shown once.
2. On the weighbridge PC (Node 22 or later): copy this folder, run `pnpm install --prod` (or `npm install --omit=dev`), copy `agent.config.example.json` to `agent.config.json` and fill in `apiUrl`, `deviceId`, `allowedOrigins` (the address of the web app).
3. Put the secret in `device.secret` (one line), or set `DEVICE_SECRET` for the process.
4. Elevated PowerShell: `.\scripts\install-task.ps1 -AgentDir <this folder>`. This starts the agent at boot and restarts it on failure. To remove it: `-Uninstall`.

The local file holds only how to reach the API. How to read the indicator lives in the device configuration on the server (and is cached locally for start-ups without network):

```json
{
  "source": { "type": "serial", "path": "COM3", "baudRate": 9600, "dataBits": 8, "parity": "none", "stopBits": 1 },
  "parser": "st-gs",
  "stable": { "count": 5, "kg": 10 },
  "offlineMs": 3000
}
```

Sources: `{ "type": "serial", "path": "COM3", "baudRate": 9600 }`, `{ "type": "tcp", "host": "192.168.1.50", "port": 4001 }`, `{ "type": "simulator" }`.

Parser profiles (`src/profiles.js`):

| Profile     | Frame example         | Notes                                                                          |
| ----------- | --------------------- | ------------------------------------------------------------------------------ |
| `st-gs`     | `ST,GS,+0041250kg`    | ST stable, US motion, OL overload; GS/NT/TR                                    |
| `digits`    | `+041250`, `41250 kg` | no motion flag: only the agent's stable rule decides                           |
| `simulator` | as `st-gs`            | built-in simulator                                                             |
| custom      | —                     | `{ "regex": "...(?<kg>...)", "motion": ["M"], "error": ["OL"], "unit": "kg" }` |

Check the indicator manual for its continuous-output format on site; if none of the profiles fits, set a custom regex with a named group `kg` (and `status`, `sign` when the frame has them).

## Weighing screen protocol (`ws://127.0.0.1:7071`)

Only pages from `allowedOrigins` may connect, so another web site open on the PC cannot capture.

- Agent → screen: `{ "type": "hello", "status" }`, `{ "type": "reading", "kg", "stable", "motion", "online", "at" }`, `{ "type": "status", "status": { "indicatorOnline", "apiOnline", "pending", "failed" } }`, `{ "type": "captured", "requestId", "deviceId", "readingId", "weightKg", "readOn", "uploaded" }`, `{ "type": "error", "requestId", "message" }`
- Screen → agent: `{ "type": "capture", "requestId" }`, `{ "type": "status" }`

## Develop

`pnpm --filter @dcl/weighbridge-agent test`. A full run against a local API: register a device with `{ "source": { "type": "simulator" }, "parser": "simulator" }`, then `AGENT_CONFIG=agent.config.json DEVICE_SECRET=... pnpm --filter @dcl/weighbridge-agent start` (or `agent:dev` to restart on changes; `pnpm dev` does not start the agent, it runs on the weighbridge PC)`.
