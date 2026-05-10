using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace FlightCareer.SimBridge;

public sealed class WebSocketServer : IAsyncDisposable
{
    private const string ComponentTag = "WebSocket";

    private readonly string _host;
    private readonly int _port;
    private readonly HttpListener _listener;
    private readonly ConcurrentDictionary<Guid, ClientSession> _clients = new();
    private readonly ConcurrentDictionary<Guid, Task> _handlerTasks = new();
    private CancellationTokenSource? _internalCts;
    private Task? _acceptLoop;
    private bool _disposed;

    /// <summary>
    /// Fires when the count of subscribed clients crosses 0↔1. Argument is the
    /// new count of subscribed clients.
    /// </summary>
    public event EventHandler<int>? SubscriptionChanged;

    /// <summary>
    /// Fires when a new WebSocket client has finished its handshake. The bridge
    /// uses this to push the current connection.status snapshot to the new
    /// client immediately, before any other traffic.
    /// </summary>
    public event EventHandler<Guid>? ClientConnected;

    public int SubscribedClientCount
    {
        get
        {
            var count = 0;
            foreach (var c in _clients.Values) if (c.Subscribed) count++;
            return count;
        }
    }

    public WebSocketServer(string host, int port)
    {
        _host = host;
        _port = port;
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://{host}:{port}/");
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _internalCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _listener.Start();
        Log.Info(ComponentTag, $"Listening on ws://{_host}:{_port}");
        _acceptLoop = Task.Run(() => AcceptLoop(_internalCts.Token));
        return Task.CompletedTask;
    }

    private async Task AcceptLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await _listener.GetContextAsync().ConfigureAwait(false);
            }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }

            if (!ctx.Request.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = (int)HttpStatusCode.BadRequest;
                ctx.Response.Close();
                continue;
            }

            // Track the handler task so DisposeAsync can drain in-flight
            // clients before tearing down the listener.
            var handlerId = Guid.NewGuid();
            var task = Task.Run(async () =>
            {
                try { await HandleClientAsync(ctx, token).ConfigureAwait(false); }
                finally { _handlerTasks.TryRemove(handlerId, out _); }
            });
            _handlerTasks[handlerId] = task;
        }
    }

    private async Task HandleClientAsync(HttpListenerContext ctx, CancellationToken token)
    {
        WebSocketContext? wsCtx = null;
        try
        {
            wsCtx = await ctx.AcceptWebSocketAsync(subProtocol: null).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Log.Warn(ComponentTag, "WebSocket handshake failed: " + ex.Message);
            try { ctx.Response.Close(); } catch { }
            return;
        }

        var ws = wsCtx.WebSocket;
        var session = new ClientSession(ws, ctx.Request.RemoteEndPoint?.ToString() ?? "?");
        _clients[session.Id] = session;
        Log.Info(ComponentTag, $"Client connected from {session.RemoteEndpoint} (id={session.Id:N})");

        var sendTask = Task.Run(() => session.RunSendLoopAsync(token));

        try
        {
            ClientConnected?.Invoke(this, session.Id);
        }
        catch (Exception ex) { Log.Error(ComponentTag, "ClientConnected handler threw", ex); }

        try
        {
            await ReceiveLoopAsync(session, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Log.Warn(ComponentTag, $"Client {session.Id:N} receive loop ended: {ex.Message}");
        }
        finally
        {
            var wasSubscribed = session.Subscribed;
            session.Subscribed = false;
            session.RequestStop();
            _clients.TryRemove(session.Id, out _);

            try { await sendTask.ConfigureAwait(false); } catch { }

            try
            {
                if (ws.State == WebSocketState.Open || ws.State == WebSocketState.CloseReceived)
                {
                    await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "client disconnect", CancellationToken.None);
                }
            }
            catch { }
            try { ws.Dispose(); } catch { }

            Log.Info(ComponentTag, $"Client {session.Id:N} disconnected");

            if (wasSubscribed)
            {
                NotifySubscriptionChanged();
            }
        }
    }

    private async Task ReceiveLoopAsync(ClientSession session, CancellationToken token)
    {
        var buffer = new byte[8192];
        var sb = new StringBuilder();

        while (!token.IsCancellationRequested && session.Socket.State == WebSocketState.Open)
        {
            sb.Clear();
            WebSocketReceiveResult result;
            do
            {
                result = await session.Socket.ReceiveAsync(new ArraySegment<byte>(buffer), token).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await session.Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "client closed", CancellationToken.None);
                    return;
                }
                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            } while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text) continue;

            DispatchInbound(session, sb.ToString());
        }
    }

    private void DispatchInbound(ClientSession session, string json)
    {
        var type = IncomingMessage.Parse(json, out var pingTs);
        switch (type)
        {
            case IncomingMessageType.Subscribe:
                if (!session.Subscribed)
                {
                    session.Subscribed = true;
                    Log.Info(ComponentTag, $"Client {session.Id:N} subscribed");
                    NotifySubscriptionChanged();
                }
                break;

            case IncomingMessageType.Unsubscribe:
                if (session.Subscribed)
                {
                    session.Subscribed = false;
                    Log.Info(ComponentTag, $"Client {session.Id:N} unsubscribed");
                    NotifySubscriptionChanged();
                }
                break;

            case IncomingMessageType.Ping:
                session.Enqueue(new PongMessage { Timestamp = pingTs > 0 ? pingTs : Protocol.NowMs() });
                break;

            default:
                session.Enqueue(new ErrorMessage { Code = "internal", Message = "Unrecognized message type" });
                break;
        }
    }

    private void NotifySubscriptionChanged()
    {
        try { SubscriptionChanged?.Invoke(this, SubscribedClientCount); }
        catch (Exception ex) { Log.Error(ComponentTag, "SubscriptionChanged handler threw", ex); }
    }

    /// <summary>
    /// Send a message to all clients. When subscribedOnly is true, only clients
    /// who have opted in via the subscribe message receive it. connection.status
    /// always passes false so unsubscribed clients see status changes.
    /// </summary>
    public void Broadcast(OutgoingMessage message, bool subscribedOnly)
    {
        foreach (var client in _clients.Values)
        {
            if (subscribedOnly && !client.Subscribed) continue;
            client.Enqueue(message);
        }
    }

    public void SendTo(Guid clientId, OutgoingMessage message)
    {
        if (_clients.TryGetValue(clientId, out var client))
            client.Enqueue(message);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        // Close-output first so clients see a clean shutdown frame before we
        // start tearing down. We don't dispose the socket here — that's the
        // handler task's responsibility, and disposing while a send is in
        // flight on another thread is unsafe.
        foreach (var client in _clients.Values)
        {
            try
            {
                if (client.Socket.State == WebSocketState.Open)
                {
                    await client.Socket.CloseOutputAsync(
                        WebSocketCloseStatus.GoingAway, "shutting down", CancellationToken.None)
                        .ConfigureAwait(false);
                }
            }
            catch { }
            client.RequestStop();
        }

        try { _internalCts?.Cancel(); } catch { }

        // Wait for handler tasks to finish — they own the per-client cleanup.
        var pendingHandlers = _handlerTasks.Values.ToArray();
        if (pendingHandlers.Length > 0)
        {
            try
            {
                var drain = Task.WhenAll(pendingHandlers);
                var winner = await Task.WhenAny(drain, Task.Delay(2000)).ConfigureAwait(false);
                if (winner != drain)
                {
                    Log.Warn(ComponentTag, $"{pendingHandlers.Length} handler task(s) did not finish within 2s of shutdown");
                }
            }
            catch { }
        }

        try { _listener.Stop(); } catch { }
        try { _listener.Close(); } catch { }

        if (_acceptLoop != null)
        {
            try { await _acceptLoop.ConfigureAwait(false); } catch { }
        }

        _internalCts?.Dispose();
    }

    private sealed class ClientSession
    {
        private readonly BlockingCollection<OutgoingMessage> _outbox = new(boundedCapacity: 256);
        private readonly CancellationTokenSource _stopCts = new();

        public Guid Id { get; } = Guid.NewGuid();
        public WebSocket Socket { get; }
        public string RemoteEndpoint { get; }
        public volatile bool Subscribed;

        public ClientSession(WebSocket socket, string remoteEndpoint)
        {
            Socket = socket;
            RemoteEndpoint = remoteEndpoint;
        }

        public void Enqueue(OutgoingMessage message)
        {
            try { _outbox.TryAdd(message, millisecondsTimeout: 50); }
            catch (ObjectDisposedException) { }
            catch (InvalidOperationException) { /* completed */ }
        }

        public void RequestStop()
        {
            try { _stopCts.Cancel(); } catch { }
            try { _outbox.CompleteAdding(); } catch { }
        }

        public async Task RunSendLoopAsync(CancellationToken external)
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(external, _stopCts.Token);
            try
            {
                foreach (var msg in _outbox.GetConsumingEnumerable(linked.Token))
                {
                    if (Socket.State != WebSocketState.Open) break;
                    try
                    {
                        // Pass runtime type explicitly so the concrete record's
                        // properties (including overridden Type) serialize even
                        // when callers passed the base OutgoingMessage.
                        var bytes = JsonSerializer.SerializeToUtf8Bytes(msg, msg.GetType(), Protocol.JsonOptions);
                        await Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, endOfMessage: true, linked.Token);
                    }
                    catch (OperationCanceledException) { break; }
                    catch (Exception ex)
                    {
                        Log.Warn(ComponentTag, $"Send to client {Id:N} failed: {ex.Message}");
                        break;
                    }
                }
            }
            catch (OperationCanceledException) { }
            finally
            {
                try { _outbox.Dispose(); } catch { }
                try { _stopCts.Dispose(); } catch { }
            }
        }
    }
}
