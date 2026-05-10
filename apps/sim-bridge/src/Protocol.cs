using System;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FlightCareer.SimBridge;

public static class Protocol
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };

    public static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

/// <summary>
/// Marker base — every outgoing message is one of the concrete record types
/// below. The wire `type` field is set on the record itself so System.Text.Json
/// emits it directly without a custom polymorphic serializer.
/// </summary>
public abstract record OutgoingMessage
{
    [JsonPropertyName("type")]
    public abstract string Type { get; }

    [JsonPropertyName("timestamp")]
    public long Timestamp { get; init; } = Protocol.NowMs();
}

public sealed record ConnectionStatusMessage : OutgoingMessage
{
    public override string Type => "connection.status";
    public required string Status { get; init; }
    public string? SimVersion { get; init; }
    public string? Message { get; init; }
}

public sealed record AircraftStateMessage : OutgoingMessage
{
    public override string Type => "aircraft.state";
    public required PositionPayload Position { get; init; }
    public required bool OnGround { get; init; }
    public required bool EngineRunning { get; init; }
    public required double FuelTotalGal { get; init; }
    public required double SimulationRate { get; init; }
    public required string Title { get; init; }
}

public sealed record PositionPayload(
    [property: JsonPropertyName("lat")] double Lat,
    [property: JsonPropertyName("lon")] double Lon,
    [property: JsonPropertyName("altitudeFt")] double AltitudeFt,
    [property: JsonPropertyName("groundSpeedKts")] double GroundSpeedKts,
    [property: JsonPropertyName("trueHeadingDeg")] double TrueHeadingDeg);

public sealed record FlightEventMessage : OutgoingMessage
{
    public override string Type => "flight.event";
    public required string Event { get; init; }
}

public sealed record PongMessage : OutgoingMessage
{
    public override string Type => "pong";
}

public sealed record ErrorMessage : OutgoingMessage
{
    public override string Type => "error";
    public required string Code { get; init; }
    public required string Message { get; init; }
}

/// <summary>
/// Inbound (client → bridge). Parsed via a discriminator probe — we look for
/// `type` in the JSON payload and dispatch.
/// </summary>
public enum IncomingMessageType
{
    Unknown,
    Subscribe,
    Unsubscribe,
    Ping,
}

public static class IncomingMessage
{
    public static IncomingMessageType Parse(string json, out long pingTimestamp)
    {
        pingTimestamp = 0;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("type", out var typeProp)) return IncomingMessageType.Unknown;
            var type = typeProp.GetString();
            return type switch
            {
                "subscribe" => IncomingMessageType.Subscribe,
                "unsubscribe" => IncomingMessageType.Unsubscribe,
                "ping" => HandlePing(doc.RootElement, out pingTimestamp),
                _ => IncomingMessageType.Unknown,
            };
        }
        catch (JsonException)
        {
            return IncomingMessageType.Unknown;
        }
    }

    private static IncomingMessageType HandlePing(JsonElement root, out long ts)
    {
        ts = 0;
        if (root.TryGetProperty("timestamp", out var tsProp) && tsProp.ValueKind == JsonValueKind.Number)
        {
            tsProp.TryGetInt64(out ts);
        }
        return IncomingMessageType.Ping;
    }
}

/// <summary>
/// Plain CLR snapshot of the aircraft state — produced by SimConnectClient and
/// translated into wire form by the bridge.
/// </summary>
public sealed record AircraftState(
    double Latitude,
    double Longitude,
    double AltitudeFt,
    double GroundSpeedKts,
    double TrueHeadingDeg,
    bool OnGround,
    bool EngineRunning,
    double FuelTotalGal,
    double SimulationRate,
    string Title);

public sealed record FlightEvent(string Name);
