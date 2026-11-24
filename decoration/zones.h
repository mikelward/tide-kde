// What tide's decoration does with its settings, free of Qt and KWin, so it
// tests with a plain C++ compiler (zones_test.cpp): which windows cast a
// shadow, how far outside a window a drag resizes it, and how dark a shadow
// is at each distance. tide SPEC.md §6.2 and §6.6 are the standard.
#pragma once

#include <algorithm>
#include <string>

namespace Tide
{

enum class Shadows { None, Floating, Focused, All };

// The settings, kwinrc's [tide-decoration] (README.md), with tide's
// defaults.
struct Settings {
    Shadows shadows = Shadows::Focused;
    int shadowSize = 16;
    int borderWidth = 0;
    bool roundedCorners = true;
    bool titleBar = true;
};

// The widest the settings go, as tide's appearance.json has them.
constexpr int ShadowSizeMax = 32;
constexpr int BorderWidthMax = 16;
// How far windows' corners are rounded, as tide's Hyprland config has it.
constexpr int Rounding = 6;
// The zone with no shadow: outside a floating window, and outside a tile's
// edge. A tile's is tide's 4 px either side of the edge, of which KWin
// allows the side outside the window (SPEC.md §4.8).
constexpr int FloatingGrab = 8;
constexpr int TileGrab = 4;

// A window's sides, as Qt::Edges numbers them.
enum Edge { Top = 1, Left = 2, Right = 4, Bottom = 8 };
// What the script says of a window it doesn't tile, or hasn't spoken of.
constexpr int Floating = -1;

struct Window {
    bool active = false;
    bool maximized = false;
    bool resizable = true;
    // Floating, or the sides of a tile that a drag moves: Edge values, or 0.
    int edges = Floating;
};

struct Margins {
    int left = 0, top = 0, right = 0, bottom = 0;
    bool operator==(const Margins &o) const
    {
        return left == o.left && top == o.top && right == o.right && bottom == o.bottom;
    }
};

inline bool parseShadows(const std::string &text, Shadows *out)
{
    static const struct {
        const char *name;
        Shadows value;
    } names[] = {{"none", Shadows::None}, {"floating", Shadows::Floating}, {"focused", Shadows::Focused}, {"all", Shadows::All}};
    for (const auto &n : names) {
        if (text == n.name) {
            *out = n.value;
            return true;
        }
    }
    return false;
}

// Whether shadows are on at all.
inline bool shadowsOn(const Settings &s)
{
    return s.shadows != Shadows::None && s.shadowSize > 0;
}

// Whether `w` casts a shadow. A maximized window has no room for one.
inline bool castsShadow(const Settings &s, const Window &w)
{
    if (!shadowsOn(s) || w.maximized) {
        return false;
    }
    switch (s.shadows) {
    case Shadows::All:
        return true;
    case Shadows::Focused:
        return w.active;
    case Shadows::Floating:
        return w.edges == Floating;
    case Shadows::None:
        break;
    }
    return false;
}

// How far outside each side of `w` a drag resizes it.
// - A floating window's zone is as wide as shadows are, whether it casts
//   one now or not, and FloatingGrab with shadows off.
// - A tile's is on the sides the script says a drag moves: as wide as its
//   shadow, and at least TileGrab.
// - A maximized window, or one that can't be resized, has none.
inline Margins zone(const Settings &s, const Window &w)
{
    if (w.maximized || !w.resizable) {
        return {};
    }
    if (w.edges == Floating) {
        const int r = shadowsOn(s) ? s.shadowSize : FloatingGrab;
        return {r, r, r, r};
    }
    const int r = std::max(castsShadow(s, w) ? s.shadowSize : 0, TileGrab);
    return {w.edges & Left ? r : 0, w.edges & Top ? r : 0, w.edges & Right ? r : 0, w.edges & Bottom ? r : 0};
}

// A color, each part of 255.
struct Rgba {
    int r = 0, g = 0, b = 0, a = 0;
    bool operator==(const Rgba &o) const
    {
        return r == o.r && g == o.g && b == o.b && a == o.a;
    }
};

// Whether a color is a dark color scheme's: its lightness, as HSL has it
// (Qt's QColor::lightness), below half. The decoration asks it of the
// title bar's color in the window's palette.
inline bool isDark(int r, int g, int b)
{
    return (std::max({r, g, b}) + std::min({r, g, b})) / 2 < 128;
}

// The shadow's color by the window's edge, as tide's shell/lib/appearance.mjs
// SHADOW_COLORS has it (make check-tide-defaults): black by day, and by
// night a soft glow of the dark palette's text color, #ededf1, as a black
// shadow hardly shows on a dark desktop.
constexpr Rgba ShadowLight{0x00, 0x00, 0x00, 0x44};
constexpr Rgba ShadowDark{0xed, 0xed, 0xf1, 0x55};

inline Rgba shadowColor(bool dark)
{
    return dark ? ShadowDark : ShadowLight;
}

// A shadow's alpha, of 255, `distance` pixels outside the window: `peak`
// by its edge (shadowColor's), fading as the square of the distance, gone
// at `size`, as tide's shadow is on every compositor.
inline int shadowAlpha(double distance, int size, int peak)
{
    if (size <= 0 || distance >= size) {
        return 0;
    }
    const double t = 1.0 - std::max(distance, 0.0) / size;
    return static_cast<int>(peak * t * t + 0.5);
}

struct Point {
    double x = 0, y = 0;
};

// Where the pointer counts as being for KDecoration's choice of the side or
// corner a drag takes (its Decoration::Private::updateSectionUnderMouse),
// given where it is, `p`, from the frame's top left.
// - A floating window keeps it: every side and corner drags.
// - On a tile, a drag moves whole sides. On a side that drags, the pointer
//   counts as at the side's middle, so no corner is taken; on a border or
//   zone that doesn't, as at the window's middle, which is no side.
// `width` and `height` are the frame's, `borders` the decoration's, and
// `titleBar` whether its top border is a title bar, which is no side.
inline Point sectionPoint(Point p, double width, double height, const Margins &borders, bool titleBar, int edges)
{
    if (edges == Floating) {
        return p;
    }
    const bool l = p.x < borders.left, r = p.x >= width - borders.right;
    const bool t = p.y < (titleBar ? 0 : borders.top), b = p.y >= height - borders.bottom;
    const bool sideX = (l && (edges & Left)) || (r && (edges & Right));
    const bool sideY = (t && (edges & Top)) || (b && (edges & Bottom));
    if (((l || r) && !sideX) || (sideY && !sideX)) {
        p.x = width / 2;
    }
    if (((t || b) && !sideY) || (sideX && !sideY)) {
        p.y = height / 2;
    }
    return p;
}

} // namespace Tide
