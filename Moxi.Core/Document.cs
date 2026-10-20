using System.Security.Cryptography;
using System.Text;

namespace Moxi.Core;

public sealed class FileConflictException() : IOException("文件已被其他程序修改。请重新打开，或另存为以保留两份内容。");

public sealed record Draft(string? Path, string Text, string SavedText, string? BaseHash, int CodePage, bool Bom, string NewLine);

public sealed class Document
{
    public const int MaxBytes = 16 * 1024 * 1024;
    public string? Path { get; private set; }
    public string Text { get; set; } = "";
    public string SavedText { get; private set; } = "";
    public string? BaseHash { get; private set; }
    public int CodePage { get; private set; } = 65001;
    public bool Bom { get; private set; }
    public string NewLine { get; private set; } = "\r\n";
    public bool IsDirty => Text != SavedText;
    public string Name => Path is null ? "未命名.md" : System.IO.Path.GetFileName(Path);
    public string EncodingLabel => CodePage == 65001 ? (Bom ? "UTF-8 BOM" : "UTF-8") : (CodePage == 1200 ? "UTF-16 LE" : "UTF-16 BE");

    public static Document Open(string path)
    {
        path = System.IO.Path.GetFullPath(path);
        if (new FileInfo(path).Length > MaxBytes) throw new IOException("文件超过 16 MB，请用专用文本编辑器打开。");
        var bytes = File.ReadAllBytes(path);
        var codePage = 65001;
        var offset = 0;
        if (bytes.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF })) offset = 3;
        else if (bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE, 0, 0 }) || bytes.AsSpan().StartsWith(new byte[] { 0, 0, 0xFE, 0xFF }))
            throw new IOException("暂不支持 UTF-32；请先转换为 UTF-8。");
        else if (bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE })) { codePage = 1200; offset = 2; }
        else if (bytes.AsSpan().StartsWith(new byte[] { 0xFE, 0xFF })) { codePage = 1201; offset = 2; }
        string text;
        try { text = Encoding.GetEncoding(codePage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback).GetString(bytes, offset, bytes.Length - offset); }
        catch (DecoderFallbackException) { throw new IOException("无法确定文件编码。请先以 UTF-8 或带 BOM 的 UTF-16 保存，避免文字损坏。"); }
        if (text.Contains('\0')) throw new IOException("文件含有二进制内容，无法作为 Markdown 打开。");
        return new Document { Path = path, Text = text, SavedText = text, BaseHash = Hash(bytes), CodePage = codePage, Bom = offset > 0,
            NewLine = text.Contains("\r\n") ? "\r\n" : text.Contains('\n') ? "\n" : text.Contains('\r') ? "\r" : "\r\n" };
    }

    public void Save(string? destination = null, bool allowReplaceDestination = false)
    {
        var target = System.IO.Path.GetFullPath(destination ?? Path ?? throw new InvalidOperationException("请选择保存位置。"));
        bool same = string.Equals(target, Path, StringComparison.OrdinalIgnoreCase);
        // Even an unchanged buffer must not claim an external edit has been saved.
        if (same && (BaseHash is null || !File.Exists(target) || Hash(File.ReadAllBytes(target)) != BaseHash)) throw new FileConflictException();
        if (!same && File.Exists(target) && !allowReplaceDestination) throw new FileConflictException();
        if (same && !IsDirty) return;
        var encoding = Encoding.GetEncoding(CodePage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
        var body = encoding.GetBytes(Text);
        if (body.Length > MaxBytes) throw new IOException("内容超过 16 MB，无法保存。");
        byte[] prefix = !Bom ? [] : CodePage switch { 65001 => [0xEF, 0xBB, 0xBF], 1200 => [0xFF, 0xFE], _ => [0xFE, 0xFF] };
        var bytes = prefix.Concat(body).ToArray();
        var temp = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(target)!, ".moxi-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            { stream.Write(bytes); stream.Flush(true); }
            // Check again immediately before atomic replacement; never delete the original first.
            if (same && (!File.Exists(target) || Hash(File.ReadAllBytes(target)) != BaseHash)) throw new FileConflictException();
            if (File.Exists(target)) File.Replace(temp, target, null);
            else File.Move(temp, target);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
        Path = target; SavedText = Text; BaseHash = Hash(bytes);
    }

    public bool ChangedOnDisk() => Path is not null && (!File.Exists(Path) || Hash(File.ReadAllBytes(Path)) != BaseHash);
    public Draft ToDraft() => new(Path, Text, SavedText, BaseHash, CodePage, Bom, NewLine);
    public static Document Restore(Draft d) => new() { Path = d.Path, Text = d.Text, SavedText = d.SavedText,
        BaseHash = d.BaseHash, CodePage = d.CodePage is 65001 or 1200 or 1201 ? d.CodePage : 65001, Bom = d.Bom,
        NewLine = d.NewLine is "\r\n" or "\n" or "\r" ? d.NewLine : "\r\n" };
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
}
