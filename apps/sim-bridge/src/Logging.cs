using System;

namespace FlightCareer.SimBridge;

public enum LogLevel
{
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

public static class Log
{
    private static readonly object Gate = new();
    public static LogLevel MinLevel { get; set; } = LogLevel.Info;

    public static void Configure(string? level)
    {
        MinLevel = (level?.Trim().ToLowerInvariant()) switch
        {
            "debug" => LogLevel.Debug,
            "info" => LogLevel.Info,
            "warn" or "warning" => LogLevel.Warn,
            "error" => LogLevel.Error,
            _ => LogLevel.Info,
        };
    }

    public static void Debug(string component, string message) => Write(LogLevel.Debug, component, message);
    public static void Info(string component, string message) => Write(LogLevel.Info, component, message);
    public static void Warn(string component, string message) => Write(LogLevel.Warn, component, message);
    public static void Error(string component, string message) => Write(LogLevel.Error, component, message);

    public static void Error(string component, string message, Exception ex) =>
        Write(LogLevel.Error, component, message + " — " + ex.GetType().Name + ": " + ex.Message);

    private static void Write(LogLevel level, string component, string message)
    {
        if (level < MinLevel) return;
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{LevelTag(level)}] [{component}] {message}";
        lock (Gate)
        {
            var prev = Console.ForegroundColor;
            Console.ForegroundColor = level switch
            {
                LogLevel.Debug => ConsoleColor.DarkGray,
                LogLevel.Warn => ConsoleColor.Yellow,
                LogLevel.Error => ConsoleColor.Red,
                _ => prev,
            };
            try { Console.WriteLine(line); }
            finally { Console.ForegroundColor = prev; }
        }
    }

    private static string LevelTag(LogLevel level) => level switch
    {
        LogLevel.Debug => "DEBUG",
        LogLevel.Info => "INFO",
        LogLevel.Warn => "WARN",
        LogLevel.Error => "ERROR",
        _ => "INFO",
    };
}
