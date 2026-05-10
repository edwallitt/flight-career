# FlightCareer SimBridge

A self-contained .NET 8 console app that connects to MSFS via SimConnect and
relays aircraft state over a localhost WebSocket. The bridge is a pipe, not a
brain — it reports what SimConnect says, and the main FlightCareer app does
all interpretation (block time, completion detection, fuel reconciliation,
etc.).

The bridge is a separate process from the main Node app on purpose: MSFS
crashes shouldn't take down the career system, and the bridge can be
restarted independently.

## Prerequisites

1. **Windows 10/11** with **MSFS 2020 or 2024** installed.
2. **.NET 8 SDK** — verify with:
   ```cmd
   dotnet --version
   ```
   You should see a version starting with `8.`. If not, install from
   <https://dotnet.microsoft.com/download>.
3. **SimConnect SDK** — ships with MSFS but you may need to install it from
   the **Developer Mode → Tools → SDK Installer** menu inside MSFS.
   The managed SimConnect assembly is typically located at:
   - **MSFS 2020**: `C:\MSFS SDK\SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll`
   - **MSFS 2024**: `C:\MSFS 2024 SDK\SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll`
4. An IDE — Visual Studio 2022, VS Code with the C# Dev Kit, or JetBrains
   Rider all work. None are strictly required (`dotnet` CLI is enough).

## Setup

1. Locate `Microsoft.FlightSimulator.SimConnect.dll` from your MSFS SDK
   install (see above).
2. Copy it into `apps/sim-bridge/lib/`. The folder is gitignored — Microsoft
   licenses the assembly with MSFS, so each developer supplies their own copy.
3. From `apps/sim-bridge/`, build:
   ```cmd
   dotnet build
   ```
4. Run it:
   ```cmd
   dotnet run
   ```
   or double-click `run.bat`.

For a redistributable single-file binary:
```cmd
dotnet publish -c Release -r win-x64 --self-contained
```
The output lands in `bin/Release/net8.0-windows/win-x64/publish/`.

## Configuration

`appsettings.json` (copied next to the binary on build):

```json
{
  "WebSocket": { "Host": "127.0.0.1", "Port": 8765 },
  "Polling": {
    "ActiveIntervalMs": 1000,
    "IdleIntervalMs": 5000,
    "ReconnectDelayMs": 5000
  },
  "Logging": { "Level": "info" }
}
```

- `ActiveIntervalMs` — emit rate while at least one client is subscribed.
- `IdleIntervalMs` — emit rate when nobody is subscribed (saves CPU).
- `ReconnectDelayMs` — delay between SimConnect reconnect attempts.
- `Logging.Level` — `debug` | `info` | `warn` | `error`.

Bad values fall back to defaults silently with a warning log line.

## Wire protocol

JSON over WebSocket. Every message has a `type` field. All timestamps are
unix milliseconds.

### Bridge → client

```jsonc
// Connection status changed (also pushed once on connect)
{ "type": "connection.status",
  "status": "connected" | "disconnected" | "connecting" | "reconnecting",
  "simVersion": "MSFS 2024" | "MSFS 2020" | null,
  "message": "...", "timestamp": 1234567890123 }

// Aircraft state — sent at ActiveIntervalMs while subscribed
{ "type": "aircraft.state", "timestamp": 1234567890123,
  "position": { "lat": 44.88, "lon": -63.50,
    "altitudeFt": 1542.3, "groundSpeedKts": 87.4, "trueHeadingDeg": 90.0 },
  "onGround": true, "engineRunning": false,
  "fuelTotalGal": 24.0, "simulationRate": 1.0,
  "title": "Cessna 152 Asobo" }

// Edge transitions (subscribed clients only)
{ "type": "flight.event",
  "event": "engine_started" | "engine_stopped" | "lifted_off" | "touched_down",
  "timestamp": 1234567890123 }

{ "type": "pong", "timestamp": 1234567890123 }
{ "type": "error", "code": "...", "message": "...", "timestamp": ... }
```

### Client → bridge

```jsonc
{ "type": "subscribe" }
{ "type": "unsubscribe" }
{ "type": "ping", "timestamp": 1234567890123 }
```

Subscribe state is per-client. `connection.status` always flows to every
client (subscribed or not) so unsubscribed clients can still display sim
status.

## Manual validation

After building:

1. `run.bat`. Console shows:
   ```
   [INFO] [Bridge] FlightCareer SimBridge starting...
   [INFO] [WebSocket] Listening on ws://127.0.0.1:8765
   [INFO] [Bridge] Attempting SimConnect connection...
   ```
2. With **MSFS not running** you should see:
   ```
   [WARN] [SimConnect] SimConnect connection failed: ... Retrying in 5s.
   ```
   The bridge stays alive and keeps retrying.
3. Start MSFS, load any flight (cold-and-dark recommended):
   ```
   [INFO] [SimConnect] Connection established: MSFS 2024 — KittyHawk Simulator v12.x.x.x
   [INFO] [SimConnect] Status: Connecting → Connected
   ```
4. Open any browser, dev tools → console:
   ```js
   const ws = new WebSocket('ws://127.0.0.1:8765');
   ws.onmessage = e => console.log(JSON.parse(e.data));
   ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe' }));
   ```
5. The first message you receive is a `connection.status` snapshot.
6. After `subscribe`, you should start receiving `aircraft.state` once per
   second.
7. Start the engine in MSFS → `flight.event` with `engine_started`.
8. Take off → `lifted_off`. Land → `touched_down`. Shut down → `engine_stopped`.
9. Quit MSFS → bridge logs the disconnect, broadcasts a `disconnected`
   status, and starts retrying.
10. Restart MSFS → bridge reconnects automatically.
11. **Ctrl+C** in the bridge console → shutdown notice broadcast to all
    clients, then clean exit.

## Troubleshooting

**`Microsoft.FlightSimulator.SimConnect could not be loaded`** — copy the
managed assembly into `apps/sim-bridge/lib/`. See **Setup** step 1.

**`SimConnect connection failed` in a loop** — MSFS isn't running, or
SimConnect isn't enabled. In MSFS, **Options → General → Developers →
SimConnect** must be on. The flight must be fully loaded, not at the main
menu.

**`HttpListenerException: Access is denied`** — another process is using
port 8765. Change `WebSocket.Port` in `appsettings.json` or stop the other
listener.

**Bridge connects but no `aircraft.state` messages** — make sure your client
sent `{"type":"subscribe"}`. Without it only `connection.status` and `pong`
flow.

**Stale `lifted_off` / `touched_down` events on connect** — by design the
first sample after connect doesn't fire edge events; transitions are detected
on the second sample onwards.

## What this bridge intentionally does NOT do

- Distance / track logging
- Fuel reconciliation
- Block-time computation
- Job-completion detection
- Authentication (localhost only)
- TLS (localhost only)
- Heartbeat from bridge to client (the client pings, the bridge pongs)
- Any GUI

All of the above are responsibilities of the main Node app that talks to the
bridge.
