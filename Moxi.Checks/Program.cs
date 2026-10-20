using System.Text;
using Moxi.Core;

var root = args.FirstOrDefault() ?? Path.Combine(Path.GetTempPath(), "moxi-checks-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var passed = 0;
void Check(string name, Action action) { action(); passed++; Console.WriteLine("PASS " + name); }
void Assert(bool value, string message = "Assertion failed") { if (!value) throw new Exception(message); }
void Throws<T>(Action action) where T : Exception { try { action(); } catch (T) { return; } throw new Exception("Expected " + typeof(T).Name); }
Check("unchanged UTF-8 remains byte-identical", () => {
 var path = Path.Combine(root, "exact.md"); var bytes = Encoding.UTF8.GetBytes("# 标题\r\n\r\n__加粗__  \r\n下一行\r\n"); File.WriteAllBytes(path, bytes);
 var d = Document.Open(path); Assert(!d.IsDirty); d.Save(); Assert(File.ReadAllBytes(path).SequenceEqual(bytes));
});
foreach (var encoding in new[] { new UTF8Encoding(true, true), (Encoding)new UnicodeEncoding(false, true, true), new UnicodeEncoding(true, true, true) })
Check("encoding and BOM retained: " + encoding.WebName, () => {
 var path = Path.Combine(root, encoding.CodePage + ".md"); File.WriteAllBytes(path, encoding.GetPreamble().Concat(encoding.GetBytes("原文\n")).ToArray());
 var d = Document.Open(path); d.Text += "编辑 μ\n"; d.Save(); var b = File.ReadAllBytes(path); Assert(b.AsSpan().StartsWith(encoding.GetPreamble())); Assert(Document.Open(path).Text == d.Text);
});
Check("new document and save-as", () => { var d = new Document { Text = "# 新文档\r\n" }; var path = Path.Combine(root, "new.md"); d.Save(path); Assert(!d.IsDirty && d.Path == path); d.Text += "正文"; var other = Path.Combine(root, "copy.md"); d.Save(other); Assert(Document.Open(path).Text != d.Text); Assert(Document.Open(other).Text == d.Text); });
Check("external modifications cannot be overwritten", () => { var path = Path.Combine(root, "conflict.md"); File.WriteAllText(path, "old"); var d = Document.Open(path); d.Text = "mine"; File.WriteAllText(path, "external"); Throws<FileConflictException>(() => d.Save()); Assert(File.ReadAllText(path) == "external"); Assert(d.IsDirty); });
Check("external deletion cannot be overwritten", () => { var path = Path.Combine(root, "deleted.md"); File.WriteAllText(path, "old"); var d = Document.Open(path); d.Text = "mine"; File.Delete(path); Throws<FileConflictException>(() => d.Save()); Assert(!File.Exists(path)); });
Check("unmodified buffer still detects disk conflict", () => { var path = Path.Combine(root, "unchanged-conflict.md"); File.WriteAllText(path, "old"); var d = Document.Open(path); File.WriteAllText(path, "new"); Throws<FileConflictException>(() => d.Save()); });
Check("draft restore retains conflict fingerprint", () => { var path = Path.Combine(root, "draft.md"); File.WriteAllText(path, "original"); var d = Document.Open(path); d.Text = "draft"; var restored = Document.Restore(d.ToDraft()); Assert(restored.Text == "draft" && restored.IsDirty); File.WriteAllText(path, "external"); Throws<FileConflictException>(() => restored.Save()); });
Check("invalid encoding rejected rather than replaced", () => { var path = Path.Combine(root, "invalid.md"); File.WriteAllBytes(path, [0xFF, 0x90]); Throws<IOException>(() => Document.Open(path)); });
Check("binary input rejected", () => { var path = Path.Combine(root, "binary.md"); File.WriteAllBytes(path, [0x61, 0, 0x62]); Throws<IOException>(() => Document.Open(path)); });
Check("image resolver rejects escapes and non-images", () => {
 File.WriteAllBytes(Path.Combine(root, "image.png"), [1,2,3]); File.WriteAllText(Path.Combine(root, "secret.txt"), "private");
 Assert(LocalResources.ResolveImage(root, "/image.png") == Path.Combine(root, "image.png"));
 Assert(LocalResources.ResolveImage(root, "/../image.png") is null); Assert(LocalResources.ResolveImage(root, "/%2e%2e/image.png") is null);
 Assert(LocalResources.ResolveImage(root, "/secret.txt") is null); Assert(LocalResources.ResolveImage(root, "/C:/image.png") is null);
});
Check("theme preference survives restart independently of document data", () => {
 var path = Path.Combine(root, "preferences", "appearance.json");
 Assert(AppearancePreferences.Load(path) == AppTheme.Dark);
 AppearancePreferences.Save(path, AppTheme.Day); Assert(AppearancePreferences.Load(path) == AppTheme.Day);
 AppearancePreferences.Save(path, AppTheme.Dark); Assert(AppearancePreferences.Load(path) == AppTheme.Dark);
 Assert(!File.Exists(path + ".tmp"));
});
Check("damaged or unknown theme preference safely defaults to dark", () => {
 var path = Path.Combine(root, "invalid-appearance.json");
 foreach (var text in new[] { "{", "null", "[]", "{\"theme\":42}", "{\"theme\":\"unknown\"}", new string('x', 4097) }) {
  File.WriteAllText(path, text); Assert(AppearancePreferences.Load(path) == AppTheme.Dark);
 }
});
Assert(!Directory.GetFiles(root, ".moxi-*.tmp").Any(), "Temporary files leaked");
Console.WriteLine($"{passed} native checks passed.");
