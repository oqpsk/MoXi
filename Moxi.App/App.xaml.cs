using System.Windows;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Moxi;

public partial class App : Application
{
    private Mutex? instance;
    private readonly CancellationTokenSource lifetime = new();
    private static readonly string InstanceName = "MoXi-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Environment.UserName)))[..16];
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var path = e.Args.FirstOrDefault(a => !a.StartsWith('-'));
        if (path is not null) path = Path.GetFullPath(path);
        instance = new Mutex(true, @"Local\" + InstanceName, out var first);
        if (!first)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", InstanceName, PipeDirection.Out, PipeOptions.Asynchronous);
                await client.ConnectAsync(3000);
                using var writer = new StreamWriter(client) { AutoFlush = true };
                await writer.WriteLineAsync(JsonSerializer.Serialize(path));
            }
            catch (Exception ex) when (ex is IOException or TimeoutException) { MessageBox.Show("MoXi 已在运行，请切回窗口后打开文件。", "MoXi"); }
            Shutdown(); return;
        }
        _ = Listen();
        new MainWindow(path).Show();
    }

    private async Task Listen()
    {
        while (!lifetime.IsCancellationRequested)
        {
            try
            {
                using var server = new NamedPipeServerStream(InstanceName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(lifetime.Token);
                using var reader = new StreamReader(server);
                var line = await reader.ReadLineAsync(lifetime.Token);
                if (line?.Length > 32768) continue;
                var path = JsonSerializer.Deserialize<string?>(line ?? "null");
                await Dispatcher.InvokeAsync(async () => { if (MainWindow is MainWindow window) await window.ReceiveFile(path); });
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) when (ex is IOException or JsonException) { }
        }
    }
    protected override void OnExit(ExitEventArgs e) { lifetime.Cancel(); instance?.Dispose(); lifetime.Dispose(); base.OnExit(e); }
}
