$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'Moxi.App/Assets'
New-Item -ItemType Directory -Path $assets -Force | Out-Null
$glyph = [Drawing.Drawing2D.GraphicsPath]::new()
$family = [Drawing.FontFamily]::new('Georgia')
$glyph.AddString([string][char]0x3BC, $family, [int][Drawing.FontStyle]::Regular, 180, [Drawing.PointF]::new(0,0), [Drawing.StringFormat]::GenericTypographic)
$bounds = $glyph.GetBounds()
$matrix = [Drawing.Drawing2D.Matrix]::new()
$matrix.Translate(-$bounds.X,-$bounds.Y); $glyph.Transform($matrix); $matrix.Dispose()
$scale = 170 / [Math]::Max($bounds.Width,$bounds.Height)
$matrix = [Drawing.Drawing2D.Matrix]::new()
$matrix.Scale($scale,$scale); $glyph.Transform($matrix); $matrix.Dispose()
$bounds = $glyph.GetBounds()
$matrix = [Drawing.Drawing2D.Matrix]::new()
$matrix.Translate((256-$bounds.Width)/2,(256-$bounds.Height)/2); $glyph.Transform($matrix); $matrix.Dispose()
$tile = [Drawing.Drawing2D.GraphicsPath]::new()
$tile.AddArc(8,8,72,72,180,90); $tile.AddArc(176,8,72,72,270,90)
$tile.AddArc(176,176,72,72,0,90); $tile.AddArc(8,176,72,72,90,90); $tile.CloseFigure()
$background = [Drawing.SolidBrush]::new([Drawing.Color]::Black)
$foreground = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#ADF4FF'))
$outline = [Drawing.Pen]::new($foreground,8)
$images = @()
foreach ($size in @(16,24,32,48,64,128,256)) {
    $bitmap = [Drawing.Bitmap]::new($size,$size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = 'AntiAlias'
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.ScaleTransform($size/256.0,$size/256.0)
    $graphics.FillPath($background,$tile); $graphics.DrawPath($outline,$tile); $graphics.FillPath($foreground,$glyph)
    $stream = [IO.MemoryStream]::new()
    $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $images += ,@($size,$stream.ToArray())
    if ($size -eq 256) { $bitmap.Save((Join-Path $assets 'MoXi.png'),[Drawing.Imaging.ImageFormat]::Png) }
    $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$output = [IO.File]::Create((Join-Path $assets 'MoXi.ico'))
$writer = [IO.BinaryWriter]::new($output)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($img in $images) {
    $s=$img[0]; $bytes=$img[1]
    $writer.Write([byte]$(if($s -eq 256){0}else{$s})); $writer.Write([byte]$(if($s -eq 256){0}else{$s}))
    $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]$offset); $offset += $bytes.Length
}
foreach($img in $images){ $writer.Write([byte[]]$img[1]) }
$writer.Dispose(); $output.Dispose()
$outline.Dispose(); $foreground.Dispose(); $background.Dispose(); $tile.Dispose(); $glyph.Dispose(); $family.Dispose()
