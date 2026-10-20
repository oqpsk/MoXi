using System.Text.Json;

namespace Moxi.Core;

public enum AppTheme { Dark, Day }

public static class AppearancePreferences
{
    public static AppTheme Load(string path)
    {
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length > 4096) return AppTheme.Dark;
            using var json = JsonDocument.Parse(File.ReadAllText(path));
            return json.RootElement.ValueKind == JsonValueKind.Object &&
                json.RootElement.TryGetProperty("theme", out var theme) &&
                theme.ValueKind == JsonValueKind.String && theme.GetString() == "day" ? AppTheme.Day : AppTheme.Dark;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        { return AppTheme.Dark; }
    }

    public static void Save(string path, AppTheme theme)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var temp = path + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(new { theme = theme == AppTheme.Day ? "day" : "dark" }));
            File.Move(temp, path, true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
