using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.FlightSimulator.SimConnect;

namespace FlightCareer.SimBridge;

/// <summary>
/// Wraps the managed SimConnect SDK. The bridge does not interpret simvars —
/// this class only relays state snapshots and edge transitions for engine and
/// on-ground flags. All flight-logic decisions live in the main app.
/// </summary>
public sealed class SimConnectClient : IDisposable
{
    private const string ComponentTag = "SimConnect";
    private const uint WM_USER_SIMCONNECT = 0x0402;

    private enum DEFINITIONS { AircraftState }
    private enum REQUESTS { AircraftState }

    [StructLayout(LayoutKind.Sequential, Pack = 1, CharSet = CharSet.Ansi)]
    private struct AircraftStateData
    {
        public double Latitude;
        public double Longitude;
        public double Altitude;
        public double GroundVelocity;
        public double TrueHeading;
        public int OnGround;
        public int EngineCombustion;
        public double FuelQuantity;
        public double SimulationRate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string Title;
    }

    private readonly int _reconnectDelayMs;
    private readonly object _gate = new();

    private SimConnect? _simconnect;
    private Thread? _pumpThread;
    private CancellationTokenSource? _internalCts;
    private bool _disposed;
    private volatile bool _quitRequested;

    private bool _hasPriorSample;
    private int _prevOnGround;
    private int _prevEngineCombustion;

    private int _activeIntervalMs;
    private long _lastEmitMs;

    public ConnectionStatus Status { get; private set; } = ConnectionStatus.Disconnected;
    public string? SimVersion { get; private set; }

    public event EventHandler<ConnectionStatus>? StatusChanged;
    public event EventHandler<AircraftState>? StateUpdated;
    public event EventHandler<FlightEvent>? EventOccurred;

    public SimConnectClient(int activeIntervalMs, int reconnectDelayMs)
    {
        _activeIntervalMs = Math.Max(100, activeIntervalMs);
        _reconnectDelayMs = Math.Max(1000, reconnectDelayMs);
    }

    public void SetPollingRate(int intervalMs)
    {
        _activeIntervalMs = Math.Max(100, intervalMs);
        Log.Debug(ComponentTag, $"Emit interval set to {_activeIntervalMs}ms");
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _internalCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var token = _internalCts.Token;

        _pumpThread = new Thread(() => RunPumpLoop(token))
        {
            IsBackground = true,
            Name = "SimConnect-Pump",
        };
        _pumpThread.Start();

        return Task.CompletedTask;
    }

    private void RunPumpLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            if (!TryConnect(token)) continue;

            try
            {
                while (!token.IsCancellationRequested && _simconnect != null && !_quitRequested)
                {
                    try
                    {
                        _simconnect.ReceiveMessage();
                    }
                    catch (COMException ex)
                    {
                        Log.Warn(ComponentTag, "Connection lost: " + ex.Message);
                        break;
                    }
                    catch (Exception ex)
                    {
                        Log.Error(ComponentTag, "Unexpected pump error", ex);
                        break;
                    }

                    // Cancellable sleep — WaitOne returns true if the token
                    // fires, so we exit promptly on shutdown.
                    if (token.WaitHandle.WaitOne(50)) break;
                }
            }
            finally
            {
                TeardownConnection();
            }

            if (token.IsCancellationRequested) break;

            // Spec requires Disconnected → Reconnecting transition after a
            // mid-session loss, so downstream sees both edges.
            SetStatus(ConnectionStatus.Disconnected, _quitRequested ? "Sim quit" : "Connection lost");
            _quitRequested = false;

            SetStatus(ConnectionStatus.Reconnecting, "Reconnecting after disconnect");
            if (token.WaitHandle.WaitOne(_reconnectDelayMs)) break;
        }

        SetStatus(ConnectionStatus.Disconnected, "Bridge shutting down");
    }

    private bool TryConnect(CancellationToken token)
    {
        SetStatus(ConnectionStatus.Connecting, "Attempting SimConnect connection");
        try
        {
            // Polling-only pattern: no HWND, no WaitHandle. The pump thread
            // calls ReceiveMessage on a 50ms cadence to drain queued events.
            // Don't "fix" this by passing a WaitHandle without also reworking
            // the pump loop — the constructor signature must stay aligned with
            // how ReceiveMessage is called below.
            _simconnect = new SimConnect("FlightCareer SimBridge", IntPtr.Zero, WM_USER_SIMCONNECT, null, 0);
            _simconnect.OnRecvOpen += OnRecvOpen;
            _simconnect.OnRecvQuit += OnRecvQuit;
            _simconnect.OnRecvException += OnRecvException;
            _simconnect.OnRecvSimobjectData += OnRecvSimobjectData;

            RegisterDataDefinition(_simconnect);

            _simconnect.RequestDataOnSimObject(
                REQUESTS.AircraftState,
                DEFINITIONS.AircraftState,
                SimConnect.SIMCONNECT_OBJECT_ID_USER,
                SIMCONNECT_PERIOD.SECOND,
                SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT,
                0, 0, 0);

            _hasPriorSample = false;
            _lastEmitMs = 0;
            return true;
        }
        catch (COMException ex)
        {
            Log.Warn(ComponentTag, $"SimConnect connection failed: {ex.Message}. Retrying in {_reconnectDelayMs / 1000}s.");
            TeardownConnection();
            token.WaitHandle.WaitOne(_reconnectDelayMs);
            return false;
        }
        catch (DllNotFoundException ex)
        {
            Log.Error(ComponentTag, "SimConnect managed assembly missing or unloadable. " +
                "Verify that lib/Microsoft.FlightSimulator.SimConnect.dll is present and matches your MSFS SDK version.", ex);
            token.WaitHandle.WaitOne(_reconnectDelayMs);
            return false;
        }
        catch (Exception ex)
        {
            Log.Error(ComponentTag, "Unexpected error during SimConnect connect", ex);
            TeardownConnection();
            token.WaitHandle.WaitOne(_reconnectDelayMs);
            return false;
        }
    }

    private static void RegisterDataDefinition(SimConnect sc)
    {
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "PLANE LATITUDE", "degrees", SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "PLANE LONGITUDE", "degrees", SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "PLANE ALTITUDE", "feet", SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "GROUND VELOCITY", "knots", SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "PLANE HEADING DEGREES TRUE", "degrees", SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "SIM ON GROUND", "bool", SIMCONNECT_DATATYPE.INT32, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "ENG COMBUSTION:1", "bool", SIMCONNECT_DATATYPE.INT32, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "FUEL TOTAL QUANTITY", "gallons", SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "SIMULATION RATE", "number", SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        sc.AddToDataDefinition(DEFINITIONS.AircraftState, "TITLE", null, SIMCONNECT_DATATYPE.STRING256, 0.0f, SimConnect.SIMCONNECT_UNUSED);

        sc.RegisterDataDefineStruct<AircraftStateData>(DEFINITIONS.AircraftState);
    }

    private void OnRecvOpen(SimConnect sender, SIMCONNECT_RECV_OPEN data)
    {
        // The wire protocol declares simVersion as one of "MSFS 2024",
        // "MSFS 2020", or null — downstream may match literally. Keep the
        // long descriptive form for human-readable status messages.
        SimVersion = ClassifySimVersion(data);
        var detail = $"{data.szApplicationName} v{data.dwApplicationVersionMajor}.{data.dwApplicationVersionMinor}.{data.dwApplicationBuildMajor}.{data.dwApplicationBuildMinor}";
        SetStatus(ConnectionStatus.Connected, $"SimConnect connected — {SimVersion ?? "unknown"} ({detail})");
        Log.Info(ComponentTag, $"Connection established: {SimVersion ?? "unknown"} — {detail}");
    }

    private static string? ClassifySimVersion(SIMCONNECT_RECV_OPEN data)
    {
        var name = data.szApplicationName ?? string.Empty;
        if (name.Contains("2024", StringComparison.OrdinalIgnoreCase)) return "MSFS 2024";
        if (name.Contains("2020", StringComparison.OrdinalIgnoreCase)) return "MSFS 2020";
        // KittyHawk = MSFS 2020 internal codename; SU14+ keeps it.
        if (name.Contains("KittyHawk", StringComparison.OrdinalIgnoreCase)) return "MSFS 2020";
        // Application version major: 11 = MSFS 2020, 12+ = MSFS 2024 family.
        if (data.dwApplicationVersionMajor >= 12) return "MSFS 2024";
        if (data.dwApplicationVersionMajor == 11) return "MSFS 2020";
        return null;
    }

    private void OnRecvQuit(SimConnect sender, SIMCONNECT_RECV data)
    {
        Log.Info(ComponentTag, "Sim sent QUIT — disconnecting");
        // Signal only — don't dispose the SDK from inside its own dispatch
        // callback. The pump loop checks _quitRequested, exits cleanly, and
        // tears down from outside the callback boundary.
        _quitRequested = true;
    }

    private void OnRecvException(SimConnect sender, SIMCONNECT_RECV_EXCEPTION data)
    {
        if (data.dwException == 0) return; // SIMCONNECT_EXCEPTION_NONE — no actual error
        Log.Warn(ComponentTag, $"SimConnect exception: code={data.dwException} sendId={data.dwSendID} index={data.dwIndex}");
    }

    private void OnRecvSimobjectData(SimConnect sender, SIMCONNECT_RECV_SIMOBJECT_DATA data)
    {
        if ((REQUESTS)data.dwRequestID != REQUESTS.AircraftState) return;
        // The managed wrapper exposes the raw payload as dwData[0] cast to the
        // struct registered via RegisterDataDefineStruct. Single-object request
        // (USER aircraft) so index 0 is correct.
        if (data.dwData == null || data.dwData.Length == 0) return;

        var raw = (AircraftStateData)data.dwData[0];
        var snapshot = new AircraftState(
            Latitude: raw.Latitude,
            Longitude: raw.Longitude,
            AltitudeFt: raw.Altitude,
            GroundSpeedKts: raw.GroundVelocity,
            TrueHeadingDeg: raw.TrueHeading,
            OnGround: raw.OnGround != 0,
            EngineRunning: raw.EngineCombustion != 0,
            FuelTotalGal: raw.FuelQuantity,
            SimulationRate: raw.SimulationRate,
            Title: raw.Title?.TrimEnd('\0') ?? string.Empty);

        EmitEdgeEvents(raw.OnGround, raw.EngineCombustion);

        var nowMs = Protocol.NowMs();
        if (nowMs - _lastEmitMs >= _activeIntervalMs)
        {
            _lastEmitMs = nowMs;
            try { StateUpdated?.Invoke(this, snapshot); }
            catch (Exception ex) { Log.Error(ComponentTag, "StateUpdated handler threw", ex); }
        }
    }

    private void EmitEdgeEvents(int onGround, int engineCombustion)
    {
        if (!_hasPriorSample)
        {
            _prevOnGround = onGround;
            _prevEngineCombustion = engineCombustion;
            _hasPriorSample = true;
            return;
        }

        if (_prevEngineCombustion == 0 && engineCombustion != 0)
            FireEvent("engine_started");
        else if (_prevEngineCombustion != 0 && engineCombustion == 0)
            FireEvent("engine_stopped");

        if (_prevOnGround != 0 && onGround == 0)
            FireEvent("lifted_off");
        else if (_prevOnGround == 0 && onGround != 0)
            FireEvent("touched_down");

        _prevOnGround = onGround;
        _prevEngineCombustion = engineCombustion;
    }

    private void FireEvent(string name)
    {
        Log.Info(ComponentTag, $"Edge: {name}");
        try { EventOccurred?.Invoke(this, new FlightEvent(name)); }
        catch (Exception ex) { Log.Error(ComponentTag, "EventOccurred handler threw", ex); }
    }

    private void SetStatus(ConnectionStatus status, string? message = null)
    {
        ConnectionStatus previous;
        lock (_gate)
        {
            previous = Status;
            Status = status;
        }
        if (previous == status) return;
        if (!string.IsNullOrEmpty(message))
            Log.Info(ComponentTag, $"Status: {previous} → {status} — {message}");
        else
            Log.Info(ComponentTag, $"Status: {previous} → {status}");
        try { StatusChanged?.Invoke(this, status); }
        catch (Exception ex) { Log.Error(ComponentTag, "StatusChanged handler threw", ex); }
    }

    private void TeardownConnection()
    {
        var sc = _simconnect;
        _simconnect = null;
        SimVersion = null;
        if (sc == null) return;

        try { sc.Dispose(); }
        catch (Exception ex) { Log.Debug(ComponentTag, "Dispose threw: " + ex.Message); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try { _internalCts?.Cancel(); }
        catch { }

        // Let the pump thread observe cancellation and tear down on its own
        // thread — disposing the SDK from outside is unsafe while the pump is
        // mid-ReceiveMessage. The Join timeout is a safety net.
        try { _pumpThread?.Join(TimeSpan.FromSeconds(3)); }
        catch { }

        // Belt and suspenders: in case the pump never ran (StartAsync not
        // called) or the Join timed out, ensure the SDK is released.
        TeardownConnection();

        _internalCts?.Dispose();
    }
}
