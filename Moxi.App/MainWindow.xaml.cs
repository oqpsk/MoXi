using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using Moxi.Core;

namespace Moxi;

public partial class MainWindow : Window
{
    private Document document = new();
    private string docId = Guid.NewGuid().ToString("N");
    private readonly string? startupPath;
    private readonly WindowBackdrop backdrop;
    private readonly string userRoot = System.IO.Path.Combine(AppContext.BaseDirectory, "userdata");
    private readonly SemaphoreSlim commands = new(1, 1);
    private readonly Dictionary<string, TaskCompletionSource<string>> snapshots = [];
    private readonly DispatcherTimer draftTimer = new() { Interval = TimeSpan.FromMilliseconds(600) };
    private bool ready, allowClose, closing, editorFailed;
    private string editorMode = "edit", editorStatus = "本地文档";
    private bool focusReading;
    private readonly JsonSerializerOptions jsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private string DraftPath => System.IO.Path.Combine(userRoot, "recovery.json");
    private string AppearancePath => System.IO.Path.Combine(userRoot, "appearance.json");

    public MainWindow(string? path)
    {
        InitializeComponent(); startupPath = path;
        backdrop = new WindowBackdrop(this, AppearancePreferences.Load(AppearancePath));
        backdrop.Changed += () => { UpdateThemeControl(); if (ready) SendAppearance(); };
        UpdateThemeControl();
        SourceInitialized += (_, _) => RestorePlacement();
        Loaded += async (_, _) => await InitializeEditor();
        Closing += OnClosing;
        Closed += (_, _) => { Browser.Dispose(); draftTimer.Stop(); };
        Activated += (_, _) => { if (ready) CheckExternalChange(); };
        draftTimer.Tick += (_, _) => { draftTimer.Stop(); SaveDraft(); };
    }

    private async Task InitializeEditor()
    {
        try
        {
            Directory.CreateDirectory(userRoot);
            var environment = await CoreWebView2Environment.CreateAsync(null, System.IO.Path.Combine(userRoot, "webview"));
            await Browser.EnsureCoreWebView2Async(environment);
            var web = Browser.CoreWebView2;
            web.Settings.AreDevToolsEnabled = false;
            web.Settings.IsStatusBarEnabled = false;
            web.Settings.IsBuiltInErrorPageEnabled = false;
            web.Settings.AreBrowserAcceleratorKeysEnabled = false;
            web.Settings.IsGeneralAutofillEnabled = false;
            web.Settings.IsPasswordAutosaveEnabled = false;
            web.SetVirtualHostNameToFolderMapping("app.moxi.local", System.IO.Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.DenyCors);
            web.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            web.NewWindowRequested += (_, e) => { e.Handled = true; OpenLink(e.Uri); };
            web.DownloadStarting += (_, e) => e.Cancel = true;
            web.NavigationStarting += (_, e) => { if (e.Uri != "https://app.moxi.local/index.html") e.Cancel = true; };
            web.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            web.WebResourceRequested += ResourceRequested;
            web.WebMessageReceived += MessageReceived;
            web.ProcessFailed += (_, e) => {
                if (e.ProcessFailedKind is not (CoreWebView2ProcessFailedKind.BrowserProcessExited or CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)) return;
                editorFailed = true; SaveDraft(); Browser.Visibility = Visibility.Collapsed;
                StartupStatus.Text = "编辑器意外停止，未保存内容已保留。请关闭后重新打开 MoXi。"; StartupStatus.Visibility = Visibility.Visible;
            };
            web.Navigate("https://app.moxi.local/index.html");
        }
        catch (Exception e) when (e is WebView2RuntimeNotFoundException or IOException or UnauthorizedAccessException or COMException)
        {
            Browser.Visibility = Visibility.Collapsed;
            StartupStatus.Text = e is WebView2RuntimeNotFoundException ? "需要 Microsoft Edge WebView2 Runtime。请安装后重新打开 MoXi。" : "无法启动编辑器。请将 MoXi 解压到可写目录后重试。";
        }
    }

    private void ResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
        if (uri.Host == "app.moxi.local") return;
        if (uri.Host == "document.moxi.local" && e.ResourceContext == CoreWebView2WebResourceContext.Image && document.Path is { } path)
        {
            var file = LocalResources.ResolveImage(System.IO.Path.GetDirectoryName(path)!, uri.AbsolutePath);
            if (file is not null)
            {
                try
                {
                    if (new FileInfo(file).Length <= 20 * 1024 * 1024)
                    {
                        var type = System.IO.Path.GetExtension(file).ToLowerInvariant() switch { ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif", ".webp" => "image/webp", ".bmp" => "image/bmp", ".ico" => "image/x-icon", _ => "image/png" };
                        e.Response = Browser.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", "Content-Type: " + type + "\r\nCache-Control: no-store"); return;
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        e.Response = Browser.CoreWebView2.Environment.CreateWebResourceResponse(null, 403, "Blocked", "");
    }

    private async void MessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (e.Source != "https://app.moxi.local/index.html") return;
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            string Str(string key) => root.TryGetProperty(key, out var value) ? value.GetString() ?? "" : "";
            var type = Str("type");
            if (type == "ready")
            {
                ready = true; StartupStatus.Visibility = Visibility.Collapsed;
                SendAppearance();
                if (TryRecover()) { LoadEditor(); if (startupPath is not null) Status("已恢复未保存的内容；保存后可打开目标文件。"); }
                else if (startupPath is not null) { await OpenPath(startupPath); }
                else await OpenGuide();
                Browser.Focus();
                return;
            }
            if (Str("docId") != docId) return;
            if (type == "view-state")
            {
                var focus = root.TryGetProperty("focus", out var f) && f.ValueKind == JsonValueKind.True;
                var outline = root.TryGetProperty("outline", out var o) && o.ValueKind == JsonValueKind.True;
                FocusButton.Tag = focus ? "Active" : null;
                OutlineButton.Tag = outline ? "Active" : null;
                focusReading = focus;
                editorMode = Str("mode") == "source" ? "source" : "edit";
                editorStatus = root.TryGetProperty("dirty", out var dirty) && dirty.ValueKind == JsonValueKind.True ? "尚未保存" : "本地文档";
                if (root.TryGetProperty("count", out var count) && count.TryGetInt32(out var characters)) CharacterCount.Text = Math.Clamp(characters, 0, Document.MaxBytes) + " 字";
                if (root.TryGetProperty("zoom", out var zoom) && zoom.TryGetInt32(out var percent)) ZoomValue.Content = Math.Clamp(percent, 70, 180) + "%";
                DirtyIndicator.Text = editorStatus == "尚未保存" ? " •" : "";
                UpdateStatusBar();
                FocusGlyph.Data = System.Windows.Media.Geometry.Parse(focus ? "M4 8H8V4M20 8H16V4M8 20V16H4M16 20V16H20" : "M8 4H4V8M16 4H20V8M4 16V20H8M20 16V20H16");
                var label = focus ? "退出专注阅读 · F11 / Esc" : "专注阅读 · F11";
                FocusButton.ToolTip = label;
                System.Windows.Automation.AutomationProperties.SetName(FocusButton, label);
                return;
            }
            if (type == "editor-status") { Status(Str("message")); return; }
            if (type == "snapshot")
            {
                if (snapshots.Remove(Str("requestId"), out var completion)) completion.TrySetResult(Str("text"));
                return;
            }
            if (root.TryGetProperty("text", out var text) && text.GetString() is { } current && current.Length <= Document.MaxBytes)
            { document.Text = current; draftTimer.Stop(); if (document.IsDirty) draftTimer.Start(); }
            if (type == "changed") return;
            if (type == "link") { OpenLink(Str("href")); return; }
            if (type == "drop")
            {
                if (e.AdditionalObjects.FirstOrDefault() is CoreWebView2File file) await RunCommand("open-path", file.Path);
                return;
            }
            if (type == "command") await RunCommand(Str("action"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException or COMException)
        { ShowError(ex); }
    }

    private async Task RunCommand(string action, string? path = null)
    {
        if (!await commands.WaitAsync(0)) return;
        try
        {
            if (action == "close") { Close(); return; }
            if (action is "save" or "save-as") { await Save(action == "save-as"); return; }
            if (action is not ("open" or "new" or "open-path")) return;
            if (!await ConfirmDirty()) return;
            if (action == "new") { ClearDraft(); document = new(); docId = Guid.NewGuid().ToString("N"); LoadEditor(); return; }
            if (path is null)
            {
                var dialog = new OpenFileDialog { Filter = "Markdown|*.md;*.markdown;*.mdown;*.mkd|文本文件|*.txt|所有文件|*.*", Title = "打开 Markdown", CheckFileExists = true };
                if (dialog.ShowDialog(this) != true) return;
                path = dialog.FileName;
            }
            await OpenPath(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { ShowError(ex); }
        finally { commands.Release(); }
    }

    public async Task ReceiveFile(string? path)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Show(); Activate();
        if (path is not null && ready) { await PullText(); await RunCommand("open-path", path); }
    }

    private Task OpenPath(string path)
    {
        try
        {
            var next = Document.Open(path); ClearDraft(); document = next; docId = Guid.NewGuid().ToString("N"); LoadEditor();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { ShowError(ex); if (ready) LoadEditor(); }
        return Task.CompletedTask;
    }

    private void LoadEditor()
    {
        UpdateFileMetadata();
        Send(new { type = "load", docId, text = document.Text, savedText = document.SavedText, name = document.Name,
            path = document.Path, encoding = document.EncodingLabel, eol = document.NewLine, focus = document.Path is not null });
    }

    private async Task OpenGuide()
    {
        try
        {
            // Practice in a persistent working copy, so updates never overwrite a user's edits.
            var guide = System.IO.Path.Combine(userRoot, "Guide.md");
            var image = System.IO.Path.Combine(userRoot, "Welcome.png");
            if (!File.Exists(guide)) File.Copy(System.IO.Path.Combine(AppContext.BaseDirectory, "Welcome.md"), guide);
            if (!File.Exists(image)) File.Copy(System.IO.Path.Combine(AppContext.BaseDirectory, "Welcome.png"), image);
            await OpenPath(guide);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { LoadEditor(); Status("无法打开使用指南，可按 Ctrl+O 打开本地文档。"); }
    }

    private void SendAppearance() => Send(new { type = "appearance", glass = backdrop.IsGlassEnabled, theme = backdrop.Theme == AppTheme.Day ? "day" : "dark" });

    private void UpdateThemeControl()
    {
        var day = backdrop.Theme == AppTheme.Day;
        SunGlyph.Visibility = day ? Visibility.Collapsed : Visibility.Visible;
        MoonGlyph.Visibility = day ? Visibility.Visible : Visibility.Collapsed;
        var label = day ? "切换到夜间模式" : "切换到日间模式";
        ThemeButton.ToolTip = label;
        System.Windows.Automation.AutomationProperties.SetName(ThemeButton, label);
    }

    private void ToggleTheme(object sender, RoutedEventArgs e)
    {
        backdrop.SetTheme(backdrop.Theme == AppTheme.Day ? AppTheme.Dark : AppTheme.Day);
        try { AppearancePreferences.Save(AppearancePath, backdrop.Theme); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Status("主题已切换，但偏好无法保存。请检查程序目录是否可写。"); }
        if (ready && !editorFailed) Browser.Focus();
    }

    private void ToggleFocus(object sender, RoutedEventArgs e) => EditorAction("focus");
    private void ToggleOutline(object sender, RoutedEventArgs e) => EditorAction("outline");
    private void ToggleMode(object sender, RoutedEventArgs e) => EditorAction("toggle-mode");
    private void ZoomOut(object sender, RoutedEventArgs e) => EditorAction("zoom-out");
    private void ZoomIn(object sender, RoutedEventArgs e) => EditorAction("zoom-in");
    private void ResetZoom(object sender, RoutedEventArgs e) => EditorAction("zoom-reset");
    private void UpdateFileMetadata()
    {
        DocumentName.Text = document.Name; FileName.ToolTip = document.Path ?? document.Name;
        FileEncoding.Text = document.EncodingLabel;
        FileLineEnding.Text = document.NewLine == "\r\n" ? "CRLF" : document.NewLine == "\r" ? "CR" : "LF";
    }
    private void UpdateStatusBar()
    {
        var current = editorMode == "source" ? "源码" : "编辑";
        var next = editorMode == "source" ? "编辑" : "源码";
        ModeButton.ToolTip = focusReading ? $"进入{current} · Ctrl+/" : $"{current} → {next} · Ctrl+/";
        System.Windows.Automation.AutomationProperties.SetName(ModeButton, focusReading ? $"进入{current}" : $"当前{current}，点击切换到{next}");
        EditorStatus.Text = (focusReading ? "专注" : current) + " · " + editorStatus;
    }
    private void EditorAction(string action)
    {
        if (!ready || editorFailed) return;
        Send(new { type = "action", action, docId });
        Browser.Focus();
    }

    private async Task<bool> Save(bool saveAs = false)
    {
        if (!await PullText()) return false;
        string? path = null;
        if (saveAs || document.Path is null)
        {
            var dialog = new SaveFileDialog { Filter = "Markdown|*.md|Markdown|*.markdown|所有文件|*.*", DefaultExt = ".md", FileName = document.Name, AddExtension = true, OverwritePrompt = true, Title = "保存 Markdown" };
            if (dialog.ShowDialog(this) != true) return false;
            path = dialog.FileName;
        }
        try
        {
            document.Save(path, allowReplaceDestination: path is not null);
            ClearDraft(); UpdateFileMetadata();
            Send(new { type = "saved", docId, text = document.SavedText, name = document.Name, path = document.Path }); return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { SaveDraft(); ShowError(ex); return false; }
    }

    private async Task<bool> PullText()
    {
        if (!ready || editorFailed) return true;
        var id = Guid.NewGuid().ToString("N"); var completion = new TaskCompletionSource<string>(); snapshots[id] = completion;
        Send(new { type = "snapshot", requestId = id, docId });
        try { document.Text = await completion.Task.WaitAsync(TimeSpan.FromSeconds(3)); return true; }
        catch (TimeoutException) { SaveDraft(); Status("编辑器没有响应。已保留最近草稿，请稍后重试。"); return false; }
        finally { snapshots.Remove(id); }
    }

    private async Task<bool> ConfirmDirty()
    {
        if (!await PullText()) return false;
        if (!document.IsDirty) return true;
        return MessageBox.Show(this, "是否保存对“" + document.Name + "”的修改？", "MoXi", MessageBoxButton.YesNoCancel, MessageBoxImage.Question) switch
        { MessageBoxResult.Yes => await Save(), MessageBoxResult.No => true, _ => false };
    }

    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (allowClose) return;
        e.Cancel = true;
        if (closing) return;
        closing = true;
        try
        {
            if (editorFailed) { SavePlacement(); SaveDraft(); allowClose = true; Close(); return; }
            if (!await ConfirmDirty()) return;
            SavePlacement(); ClearDraft(); allowClose = true; Close();
        }
        finally { closing = false; }
    }

    private void SaveDraft()
    {
        if (!document.IsDirty) { ClearDraft(); return; }
        try
        {
            Directory.CreateDirectory(userRoot);
            var temp = DraftPath + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(document.ToDraft())); File.Move(temp, DraftPath, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Status("草稿无法写入，请及时保存文档。"); }
    }

    private bool TryRecover()
    {
        try
        {
            if (!File.Exists(DraftPath) || new FileInfo(DraftPath).Length > Document.MaxBytes * 3) return false;
            var draft = JsonSerializer.Deserialize<Draft>(File.ReadAllText(DraftPath));
            if (draft is null || draft.Text == draft.SavedText) return false;
            if (MessageBox.Show(this, "发现上次未保存的草稿，是否恢复？", "MoXi", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) { ClearDraft(); return false; }
            document = Document.Restore(draft); return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { Status("无法读取恢复草稿。"); return false; }
    }
    private void ClearDraft() { draftTimer.Stop(); try { if (File.Exists(DraftPath)) File.Delete(DraftPath); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { } }
    private void CheckExternalChange() { try { if (document.ChangedOnDisk()) Status("文件已被外部修改。请重新打开，或将当前内容另存为。"); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Status("暂时无法检查原文件。"); } }
    private void Status(string text) { editorStatus = text; UpdateStatusBar(); }
    private void Send(object message) => Browser.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, jsonOptions));
    private void ShowError(Exception e) { var text = e is FileConflictException ? e.Message : e is UnauthorizedAccessException ? "无法访问此文件，请检查权限或另存为。" : e.Message; Status(text); MessageBox.Show(this, text, "MoXi", MessageBoxButton.OK, MessageBoxImage.Information); }

    private void OpenLink(string href)
    {
        if (href.StartsWith('#')) return;
        if (Uri.TryCreate(href, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" or "mailto")
        { try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch (Win32Exception) { Status("无法打开链接。"); } return; }
        if (document.Path is null || href.Contains(':')) return;
        try
        {
            var path = System.IO.Path.GetFullPath(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(document.Path)!, Uri.UnescapeDataString(href.Split('#')[0])));
            if (System.IO.Path.GetExtension(path).ToLowerInvariant() is ".md" or ".markdown" or ".mdown" or ".mkd") _ = RunCommand("open-path", path);
        }
        catch (ArgumentException) { Status("链接地址无效。"); }
    }
    private void DragTitle(object sender, MouseButtonEventArgs e)
    {
        for (var p = e.OriginalSource as DependencyObject; p is not null; p = System.Windows.Media.VisualTreeHelper.GetParent(p)) if (p is System.Windows.Controls.Button) return;
        if (e.ClickCount == 2) Maximize(sender, e); else if (e.LeftButton == MouseButtonState.Pressed) DragMove();
    }
    private void Minimize(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Maximize(object sender, RoutedEventArgs e) => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
    private void CloseWindow(object sender, RoutedEventArgs e) => Close();
    private sealed record Placement(double Left, double Top, double Width, double Height, bool Maximized);
    private void SavePlacement()
    {
        try { var r = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds; File.WriteAllText(System.IO.Path.Combine(userRoot, "window.json"), JsonSerializer.Serialize(new Placement(r.Left, r.Top, r.Width, r.Height, WindowState == WindowState.Maximized))); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
    private void RestorePlacement()
    {
        try
        {
            var p = JsonSerializer.Deserialize<Placement>(File.ReadAllText(System.IO.Path.Combine(userRoot, "window.json")));
            if (p is null || !double.IsFinite(p.Width) || !double.IsFinite(p.Height) || !double.IsFinite(p.Left) || !double.IsFinite(p.Top)) return;
            var area = SystemParameters.WorkArea; Width = Math.Clamp(p.Width, MinWidth, Math.Max(MinWidth, area.Width)); Height = Math.Clamp(p.Height, MinHeight, Math.Max(MinHeight, area.Height));
            Left = Math.Clamp(p.Left, area.Left, Math.Max(area.Left, area.Right - Width)); Top = Math.Clamp(p.Top, area.Top, Math.Max(area.Top, area.Bottom - Height));
            if (p.Maximized) WindowState = WindowState.Maximized;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException) { }
    }
}
