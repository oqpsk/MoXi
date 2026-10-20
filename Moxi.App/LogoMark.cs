using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace Moxi;

// Draw the brand directly, without a bitmap URI or external file dependency.
public sealed class LogoMark : FrameworkElement
{
    private readonly Geometry glyph;
    private static readonly Brush Cyan = new SolidColorBrush(Color.FromRgb(0xAD, 0xF4, 0xFF));
    public LogoMark()
    {
        Width = Height = 24; IsHitTestVisible = false; Focusable = false;
        glyph = new FormattedText("μ", CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            new Typeface("Georgia"), 24, Brushes.Black, 1).BuildGeometry(new Point()).Clone();
        var bounds = glyph.Bounds; var scale = Math.Min(16.5 / bounds.Width, 16.5 / bounds.Height);
        glyph.Transform = new MatrixTransform(scale, 0, 0, scale,
            12 - (bounds.X + bounds.Width / 2) * scale, 12 - (bounds.Y + bounds.Height / 2) * scale);
        glyph.Freeze();
    }
    protected override void OnRender(DrawingContext context)
    {
        context.DrawRoundedRectangle(Brushes.Black, new Pen(Cyan, 1), new Rect(.5, .5, 23, 23), 5.28, 5.28);
        context.DrawGeometry(Cyan, null, glyph);
    }
}
