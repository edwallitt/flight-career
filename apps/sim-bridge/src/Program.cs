using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace FlightCareer.SimBridge;

public sealed record BridgeConfig(
    string Host,
    int Port,
    int ActiveIntervalMs,
    int IdleIntervalMs,
    int ReconnectDelayMs,
    string LogLevel)
{
    public static BridgeConfig Defaults => new(
        Host: "127.0.0.1",
        Port: 8765,
        ActiveIntervalMs: 1000,
        IdleIntervalMs: 5000,
        ReconnectDelayMs: 5000,
        LogLevel: "info");

    public static BridgeConfig Load(string path)
    {
        if (!File.Exists(path))
        {
            Log.Warn("Bridge", $"appsettings.json not found at {path}; using defaults");
            return Defaults;
        }
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var ws = TryGet(root, "WebSocket");
            var poll = TryGet(root, "Polling");
            var log = TryGet(root, "Logging");

            return new BridgeConfig(
                Host: GetString(ws, "Host", Defaults.Host),
                Port: GetInt(ws, "Port", Defaults.Port),
                ActiveIntervalMs: GetInt(poll, "ActiveIntervalMs", Defaults.ActiveIntervalMs),
                IdleIntervalMs: GetInt(poll, "IdleIntervalMs", Defaults.IdleIntervalMs),
                ReconnectDelayMs: GetInt(poll, "ReconnectDelayMs", Defaults.ReconnectDelayMs),
                LogLevel: GetString(log, "Level", Defaults.LogLevel));
        }
        catch (Exception ex)
        {
            Log.Warn("Bridge", $"Failed to parse appsettings.json: {ex.Message}. Using defaults.");
            return Defaults;
        }
    }

    private static JsonElement? TryGet(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var v) ? v : null;

    private static string GetString(JsonElement? el, string name, string fallback)
    {
        if (el is not { } parent) return fallback;
        if (!parent.TryGetProperty(name, out var v)) return fallback;
        return v.ValueKind == JsonValueKind.String ? (v.GetString() ?? fallback) : fallback;
    }

    private static int GetInt(JsonElement? el, string name, int fallback)
    {
        if (el is not { } parent) return fallback;
        if (!parent.TryGetProperty(name, out var v)) return fallback;
        return v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : fallback;
    }
}

public static class Program
{
    private const string ComponentTag = "Bridge";

    public static async Task<int> Main(string[] args)
    {
        var configPath = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        var config = BridgeConfig.Load(configPath);
        Log.Configure(config.LogLevel);

        Log.Info(ComponentTag, "FlightCareer SimBridge starting...");
        Log.Info(ComponentTag,
            $"Config loaded: WebSocket on {config.Host}:{config.Port}, " +
            $"polling {config.ActiveIntervalMs}ms active / {config.IdleIntervalMs}ms idle, " +
            $"reconnect every {config.ReconnectDelayMs}ms");

        using var rootCts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            Log.Info(ComponentTag, "Ctrl+C received — shutting down");
            try { rootCts.Cancel(); } catch { }
        };

        var ws = new WebSocketServer(config.Host, config.Port);
        var sim = new SimConnectClient(config.IdleIntervalMs, config.ReconnectDelayMs);

        // Wire SimConnect → WebSocket
        sim.StatusChanged += (_, status) =>
        {
            ws.Broadcast(new ConnectionStatusMessage
            {
                Status = status.ToWireString(),
                SimVersion = sim.SimVersion,
            }, subscribedOnly: false);
        };
        sim.StateUpdated += (_, state) =>
        {
            if (ws.SubscribedClientCount == 0) return;
            ws.Broadcast(StateToMessage(state), subscribedOnly: true);
        };
        sim.EventOccurred += (_, ev) =>
        {
            ws.Broadcast(new FlightEventMessage { Event = ev.Name }, subscribedOnly: true);
        };

        // Wire WebSocket subscription changes → SimConnect emit rate
        ws.SubscriptionChanged += (_, count) =>
        {
            if (count > 0)
            {
                Log.Info("WebSocket", $"{count} client(s) subscribed; switching to active polling ({config.ActiveIntervalMs}ms)");
                sim.SetPollingRate(config.ActiveIntervalMs);
            }
            else
            {
                Log.Info("WebSocket", $"No subscribers; switching to idle polling ({config.IdleIntervalMs}ms)");
                sim.SetPollingRate(config.IdleIntervalMs);
            }
        };

        // New clients receive an immediate connection.status snapshot
        ws.ClientConnected += (_, clientId) =>
        {
            ws.SendTo(clientId, new ConnectionStatusMessage
            {
                Status = sim.Status.ToWireString(),
                SimVersion = sim.SimVersion,
                Message = "snapshot at connect",
            });
        };

        Log.Info(ComponentTag, $"Starting WebSocket server on {config.Host}:{config.Port}");
        await ws.StartAsync(rootCts.Token).ConfigureAwait(false);

        Log.Info(ComponentTag, "Attempting SimConnect connection...");
        await sim.StartAsync(rootCts.Token).ConfigureAwait(false);

        Log.Info(ComponentTag, "Bridge ready. Listening for clients.");

        try
        {
            await Task.Delay(Timeout.Infinite, rootCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }

        Log.Info(ComponentTag, "Broadcasting shutdown notice to clients");
        ws.Broadcast(new ConnectionStatusMessage
        {
            Status = "disconnected",
            Message = "Bridge shutting down",
        }, subscribedOnly: false);

        // Give clients a brief moment to receive the shutdown notice.
        await Task.Delay(200).ConfigureAwait(false);

        sim.Dispose();
        await ws.DisposeAsync().ConfigureAwait(false);

        Log.Info(ComponentTag, "Shutdown complete");
        return 0;
    }

    private static AircraftStateMessage StateToMessage(AircraftState state) => new()
    {
        Position = new PositionPayload(
            Lat: state.Latitude,
            Lon: state.Longitude,
            AltitudeFt: state.AltitudeFt,
            GroundSpeedKts: state.GroundSpeedKts,
            TrueHeadingDeg: state.TrueHeadingDeg),
        OnGround = state.OnGround,
        EngineRunning = state.EngineRunning,
        FuelTotalGal = state.FuelTotalGal,
        SimulationRate = state.SimulationRate,
        Title = state.Title,
    };
}
