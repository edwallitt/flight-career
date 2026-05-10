namespace FlightCareer.SimBridge;

public enum ConnectionStatus
{
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

public static class ConnectionStatusExtensions
{
    public static string ToWireString(this ConnectionStatus status) => status switch
    {
        ConnectionStatus.Connected => "connected",
        ConnectionStatus.Connecting => "connecting",
        ConnectionStatus.Reconnecting => "reconnecting",
        _ => "disconnected",
    };
}
