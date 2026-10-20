using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;
using Moxi.Core;

namespace Moxi;

// Adapted from LeXi's Windows Theme. Copyright (c) 2026 oqpsk, MIT.
// The same full-client Desktop Acrylic path; see licenses/LeXi-LICENSE.txt.
internal sealed class WindowBackdrop
{
    public bool IsGlassEnabled { get; private set; }
    public AppTheme Theme { get; private set; }
    public event Action? Changed;
    private readonly Window window;

    public WindowBackdrop(Window window, AppTheme theme)
    {
        this.window = window;
        Theme = theme;
        ApplyPalette();
        window.WindowStyle = WindowStyle.None;
        WindowChrome.SetWindowChrome(window, new WindowChrome
        {
            CaptionHeight = 0, ResizeBorderThickness = new(12), GlassFrameThickness = new(0),
            CornerRadius = new(12), UseAeroCaptionButtons = false
        });
        window.SourceInitialized += (_, _) =>
        {
            var handle = new WindowInteropHelper(window).Handle;
            if (HwndSource.FromHwnd(handle) is not { } source) return;
            void Refresh() { if (!source.IsDisposed) Apply(window, source); }
            HwndSourceHook hook = (IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled) =>
            {
                if (message is 0x031E or 0x001A or 0x031A) window.Dispatcher.BeginInvoke(Refresh);
                return IntPtr.Zero;
            };
            source.AddHook(hook);
            window.Closed += (_, _) => { if (!source.IsDisposed) source.RemoveHook(hook); };
            Refresh();
        };
    }

    public void SetTheme(AppTheme theme)
    {
        Theme = theme;
        ApplyPalette();
        if (PresentationSource.FromVisual(window) is HwndSource source) Apply(window, source);
    }

    private void ApplyPalette()
    {
        var day = Theme == AppTheme.Day;
        void Brush(string key, string value) => window.Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(value));
        Brush("Canvas", day ? "#FBFCFD" : "#191A1D");
        Brush("Ink", day ? "#28383E" : "#EDEEF1");
        Brush("Muted", day ? "#5C7078" : "#ADB0BA");
        Brush("Hover", day ? "#DCE8EB" : "#303136");
        Brush("Accent", day ? "#236F7D" : "#ADF4FF");
        Brush("WindowStroke", day ? "#C6D5DB" : "#36383F");
        Brush("PanelSurface", day ? "#D9F8FBFC" : "#99222327");
        Brush("TitleSurface", day ? "#BFFFFFFF" : "#1817171B");
        Brush("WindowSurface", day ? "#FBFCFD" : "#191A1D");
        window.Background = (Brush)window.Resources["Canvas"];
    }

    private static bool TransparencyEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("EnableTransparency") is not int enabled || enabled != 0;
        }
        catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or System.IO.IOException)
        { return false; }
    }

    private void Apply(Window window, HwndSource source)
    {
        var day = Theme == AppTheme.Day;
        int dark = day ? 0 : 1, rounded = 2, noCaption = unchecked((int)0xFFFFFFFE);
        DwmSetWindowAttribute(source.Handle, 20, ref dark, sizeof(int));
        DwmSetWindowAttribute(source.Handle, 33, ref rounded, sizeof(int));
        // LeXi suppresses the accent caption before extending glass over the full client.
        var captionHidden = DwmSetWindowAttribute(source.Handle, 35, ref noCaption, sizeof(int)) == 0;
        var composition = DwmIsCompositionEnabled(out var enabled) == 0 && enabled;
        var useGlass = captionHidden && Environment.OSVersion.Version >= new Version(10, 0, 22621) &&
            composition && TransparencyEnabled() && !SystemParameters.HighContrast;
        var chrome = WindowChrome.GetWindowChrome(window);
        if (useGlass)
        {
            int acrylic = 3; // DWMSBT_TRANSIENTWINDOW, identical to LeXi.
            var margins = new Margins(-1);
            useGlass = DwmSetWindowAttribute(source.Handle, 38, ref acrylic, sizeof(int)) == 0 &&
                DwmExtendFrameIntoClientArea(source.Handle, ref margins) == 0;
            if (useGlass)
            {
                try { chrome.GlassFrameThickness = new(-1); }
                catch (COMException) { useGlass = false; }
            }
        }
        if (useGlass)
        {
            window.Background = Brushes.Transparent;
            source.CompositionTarget.BackgroundColor = Colors.Transparent;
            window.Resources["WindowSurface"] = new SolidColorBrush(day ? Color.FromArgb(0xD8, 0xFB, 0xFC, 0xFD) : Color.FromArgb(0x28, 0x19, 0x1A, 0x1D));
        }
        else
        {
            var opaque = new SolidColorBrush(day ? Color.FromRgb(0xFB, 0xFC, 0xFD) : Color.FromRgb(0x19, 0x1A, 0x1D));
            window.Background = opaque;
            window.Resources["WindowSurface"] = opaque;
            source.CompositionTarget.BackgroundColor = opaque.Color;
            int none = 1;
            DwmSetWindowAttribute(source.Handle, 38, ref none, sizeof(int));
            try { chrome.GlassFrameThickness = new(0); }
            catch (COMException) { }
        }
        IsGlassEnabled = useGlass;
        Changed?.Invoke();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Margins(int value)
    { public int Left = value, Right = value, Top = value, Bottom = value; }
    [DllImport("dwmapi.dll")] private static extern int DwmIsCompositionEnabled([MarshalAs(UnmanagedType.Bool)] out bool enabled);
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr handle, ref Margins margins);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
}
