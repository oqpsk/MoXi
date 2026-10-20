namespace Moxi.Core;

public static class LocalResources
{
    public static string? ResolveImage(string root, string requestPath)
    {
        try
        {
            var relative = Uri.UnescapeDataString(requestPath.TrimStart('/')).Replace('/', System.IO.Path.DirectorySeparatorChar);
            if (System.IO.Path.IsPathRooted(relative) || relative.Contains(':')) return null;
            var folder = System.IO.Path.GetFullPath(root).TrimEnd(System.IO.Path.DirectorySeparatorChar) + System.IO.Path.DirectorySeparatorChar;
            var path = System.IO.Path.GetFullPath(System.IO.Path.Combine(folder, relative));
            if (!path.StartsWith(folder, StringComparison.OrdinalIgnoreCase)) return null;
            if (System.IO.Path.GetExtension(path).ToLowerInvariant() is not (".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".bmp" or ".ico")) return null;
            // Do not follow directory junctions or symlinks out of the document directory.
            for (var part = path; part.Length >= folder.TrimEnd(System.IO.Path.DirectorySeparatorChar).Length; part = System.IO.Path.GetDirectoryName(part) ?? "")
            {
                if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0) return null;
                if (part.Length == 0) break;
            }
            return path;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { return null; }
    }
}
