// zones.h's rules, with no Qt: `make test-zones` builds and runs this.
#include "zones.h"

#include <cstdio>

using namespace Tide;

static int failures = 0;

#define CHECK(what) \
    do { \
        if (!(what)) { \
            std::printf("%s:%d: %s\n", __FILE__, __LINE__, #what); \
            failures++; \
        } \
    } while (0)

static Window window(int edges, bool active = false)
{
    Window w;
    w.edges = edges;
    w.active = active;
    return w;
}

static bool at(Point p, double x, double y)
{
    return p.x == x && p.y == y;
}

int main()
{
    const Settings defaults;
    Settings none = defaults, floating = defaults, all = defaults, small = defaults, zero = defaults;
    none.shadows = Shadows::None;
    floating.shadows = Shadows::Floating;
    all.shadows = Shadows::All;
    small.shadowSize = 2;
    zero.shadowSize = 0;

    // tide's defaults: the focused window's shadow, 16 px, no border
    CHECK(defaults.shadows == Shadows::Focused && defaults.shadowSize == 16 && defaults.borderWidth == 0);
    CHECK(defaults.roundedCorners && defaults.titleBar);

    // Which windows cast a shadow
    CHECK(castsShadow(defaults, window(Floating, true)));
    CHECK(!castsShadow(defaults, window(Floating, false)));
    CHECK(castsShadow(defaults, window(Right, true)));
    CHECK(!castsShadow(defaults, window(Right, false)));
    CHECK(castsShadow(floating, window(Floating, false)));
    CHECK(!castsShadow(floating, window(Right, true)));
    CHECK(castsShadow(all, window(0, false)));
    CHECK(!castsShadow(none, window(Floating, true)));
    CHECK(!castsShadow(zero, window(Floating, true)));
    Window maximized = window(Floating, true);
    maximized.maximized = true;
    CHECK(!castsShadow(all, maximized));

    // A floating window's zone is the shadow's reach, casting one or not
    CHECK((zone(defaults, window(Floating, true)) == Margins{16, 16, 16, 16}));
    CHECK((zone(defaults, window(Floating, false)) == Margins{16, 16, 16, 16}));
    CHECK((zone(small, window(Floating, false)) == Margins{2, 2, 2, 2}));
    // With shadows off, 8 px
    CHECK((zone(none, window(Floating, true)) == Margins{8, 8, 8, 8}));
    CHECK((zone(zero, window(Floating, true)) == Margins{8, 8, 8, 8}));

    // A tile's zone is on the sides that drag: its shadow's reach, or 4 px
    CHECK((zone(defaults, window(Right, true)) == Margins{0, 0, 16, 0}));
    CHECK((zone(defaults, window(Right, false)) == Margins{0, 0, 4, 0}));
    CHECK((zone(defaults, window(Left | Right, true)) == Margins{16, 0, 16, 0}));
    CHECK((zone(all, window(Left, false)) == Margins{16, 0, 0, 0}));
    CHECK((zone(floating, window(Left, true)) == Margins{4, 0, 0, 0}));
    CHECK((zone(none, window(Left, true)) == Margins{4, 0, 0, 0}));
    CHECK((zone(small, window(Left, true)) == Margins{4, 0, 0, 0}));
    // A tile with nothing to resize has none
    CHECK((zone(all, window(0, true)) == Margins{}));

    // Nor has a maximized window, or one of a fixed size
    CHECK((zone(all, maximized) == Margins{}));
    Window fixed = window(Floating, true);
    fixed.resizable = false;
    CHECK((zone(all, fixed) == Margins{}));

    // The shadow: 0x44 by the window, fading as the square, gone at its size
    CHECK(shadowAlpha(0, 16) == 0x44);
    CHECK(shadowAlpha(-3, 16) == 0x44);
    CHECK(shadowAlpha(8, 16) == 17);
    CHECK(shadowAlpha(16, 16) == 0);
    CHECK(shadowAlpha(40, 16) == 0);
    CHECK(shadowAlpha(0, 0) == 0);

    // The settings' names
    Shadows mode = Shadows::None;
    CHECK(parseShadows("focused", &mode) && mode == Shadows::Focused);
    CHECK(parseShadows("floating", &mode) && mode == Shadows::Floating);
    CHECK(parseShadows("all", &mode) && mode == Shadows::All);
    CHECK(parseShadows("none", &mode) && mode == Shadows::None);
    CHECK(!parseShadows("active", &mode) && mode == Shadows::None);

    // A floating window keeps the pointer where it is: corners drag
    const Margins bar{0, 30, 0, 0}, border{2, 2, 2, 2};
    CHECK(at(sectionPoint({-5, -5}, 800, 600, bar, true, Floating), -5, -5));
    // A tile's side that drags takes no corner
    CHECK(at(sectionPoint({805, 3}, 800, 600, bar, true, Right), 805, 300));
    CHECK(at(sectionPoint({805, 599}, 800, 600, bar, true, Right), 805, 300));
    CHECK(at(sectionPoint({-3, 10}, 800, 600, bar, true, Left | Right), -3, 300));
    // Its title bar stays one
    CHECK(at(sectionPoint({400, 10}, 800, 600, bar, true, Right), 400, 10));
    // A border on a side that doesn't drag is no side
    CHECK(at(sectionPoint({1, 300}, 800, 600, border, false, Right), 400, 300));
    CHECK(at(sectionPoint({400, 1}, 800, 600, border, false, Right), 400, 300));
    CHECK(at(sectionPoint({400, 599}, 800, 600, border, false, Right), 400, 300));
    CHECK(at(sectionPoint({799, 300}, 800, 600, border, false, Right), 799, 300));
    // A side that drags up or down takes no corner either
    CHECK(at(sectionPoint({1, 601}, 800, 600, border, false, Bottom), 400, 601));
    // Two sides that drag meet in a corner
    CHECK(at(sectionPoint({801, 601}, 800, 600, border, false, Right | Bottom), 801, 601));
    // Inside the window nothing changes
    CHECK(at(sectionPoint({400, 300}, 800, 600, border, false, 0), 400, 300));

    if (failures) {
        std::printf("%d failed\n", failures);
        return 1;
    }
    std::printf("zones: ok\n");
    return 0;
}
