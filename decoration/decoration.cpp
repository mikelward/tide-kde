// tide's window decoration for KWin 6 (SPEC.md §4.8): a window's shadow is
// where a drag resizes it, floating or tiled, as on tide's other
// compositors (tide SPEC.md §6.6).
//
// - The zone is KDecoration's resize-only borders, which KWin adds to the
//   window's input region and resizes from, with its own cursor
//   (KWin's Window::updateDecorationInputShape, processDecorationButtonPress).
// - The shadow, the border and the corners follow tide's Borders settings,
//   which `make setup` copies into kwinrc's [tide-decoration].
// - tide's KWin script says which sides of each tile a drag moves, over
//   D-Bus (Registry). A window it hasn't spoken of floats.
// - zones.h has the rules, free of Qt.
#include "zones.h"

#include <KDecoration3/DecoratedWindow>
#include <KDecoration3/Decoration>
#include <KDecoration3/DecorationButton>
#include <KDecoration3/DecorationButtonGroup>
#include <KDecoration3/DecorationSettings>
#include <KDecoration3/DecorationShadow>

#include <KConfigGroup>
#include <KPluginFactory>
#include <KSharedConfig>

#include <QDBusConnection>
#include <QDBusMessage>
#include <QFontMetricsF>
#include <QHash>
#include <QHoverEvent>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>
#include <QPainter>
#include <QPainterPath>
#include <QPointer>
#include <QSet>
#include <QUuid>

#include <cmath>

Q_LOGGING_CATEGORY(TIDE, "tide.decoration", QtInfoMsg)

namespace Tide
{

using KDecoration3::ColorGroup;
using KDecoration3::ColorRole;
using KDecoration3::DecorationButtonType;

// A border's color, tide's palette's surface-3, the same on every window.
static const QColor BorderDark(0x46, 0x46, 0x4d);
static const QColor BorderLight(0xdc, 0xdc, 0xe2);

// kwinrc's [tide-decoration], read as KWin starts and again each time it
// reconfigures. A setting that makes no sense keeps its default, and
// KWin's log names it.
static Settings readSettings()
{
    auto config = KSharedConfig::openConfig(QStringLiteral("kwinrc"));
    config->reparseConfiguration();
    const KConfigGroup group = config->group(QStringLiteral("tide-decoration"));
    Settings s;
    const QString shadows = group.readEntry("Shadows", QString());
    if (!shadows.isEmpty() && !parseShadows(shadows.toStdString(), &s.shadows)) {
        qCWarning(TIDE) << "kwinrc's [tide-decoration] Shadows must be none, floating, focused or all, not" << shadows << "; using focused";
    }
    const auto number = [&group](const char *key, int fallback, int max) {
        const QString text = group.readEntry(key, QString());
        if (text.isEmpty()) {
            return fallback;
        }
        bool ok = false;
        const int v = text.toInt(&ok);
        if (!ok || v < 0 || v > max) {
            qCWarning(TIDE) << "kwinrc's [tide-decoration]" << key << "must be a whole number from 0 to" << max << ", not" << text << "; using" << fallback;
            return fallback;
        }
        return v;
    };
    const auto flag = [&group](const char *key, bool fallback) {
        const QString text = group.readEntry(key, QString());
        if (text.isEmpty()) {
            return fallback;
        }
        if (text != QLatin1String("true") && text != QLatin1String("false")) {
            qCWarning(TIDE) << "kwinrc's [tide-decoration]" << key << "must be true or false, not" << text << "; using" << fallback;
            return fallback;
        }
        return text == QLatin1String("true");
    };
    s.shadowSize = number("ShadowSize", s.shadowSize, ShadowSizeMax);
    s.borderWidth = number("BorderWidth", s.borderWidth, BorderWidthMax);
    s.roundedCorners = flag("RoundedCorners", s.roundedCorners);
    s.titleBar = flag("TitleBar", s.titleBar);
    // Said once for each change, not once for each window
    static QString said;
    const QString now = QStringLiteral("shadows %1, %2 px; border %3 px; corners %4; title bar %5")
                            .arg(shadows.isEmpty() || s.shadows == Shadows::Focused ? QStringLiteral("focused") : s.shadows == Shadows::None ? QStringLiteral("none") : s.shadows == Shadows::All ? QStringLiteral("all") : QStringLiteral("floating"))
                            .arg(s.shadowSize)
                            .arg(s.borderWidth)
                            .arg(s.roundedCorners ? QStringLiteral("round") : QStringLiteral("square"), s.titleBar ? QStringLiteral("on") : QStringLiteral("off"));
    if (now != said) {
        said = now;
        qCInfo(TIDE).noquote() << "settings:" << now;
    }
    return s;
}

// How far `p` is outside a box at the origin, `w` by `h`, with corners
// rounded by `radius`; 0 or less inside it.
static double outside(QPointF p, double w, double h, double radius)
{
    const double dx = std::abs(p.x() - w / 2) - (w / 2 - radius);
    const double dy = std::abs(p.y() - h / 2) - (h / 2 - radius);
    return std::hypot(std::max(dx, 0.0), std::max(dy, 0.0)) + std::min(std::max(dx, dy), 0.0) - radius;
}

// tide's shadow `size` pixels far around a window with corners rounded by
// `radius`: one for every window alike, as KWin stretches its sides.
static std::shared_ptr<KDecoration3::DecorationShadow> shadowFor(int size, int radius)
{
    static QHash<QPair<int, int>, std::shared_ptr<KDecoration3::DecorationShadow>> made;
    auto &shadow = made[{size, radius}];
    if (shadow) {
        return shadow;
    }
    // A box with a pixel between its corners, and the shadow's reach around
    const int corner = size + radius;
    const int side = 2 * corner + 1;
    const double box = 2 * radius + 1;
    QImage image(side, side, QImage::Format_ARGB32_Premultiplied);
    for (int y = 0; y < side; y++) {
        auto *line = reinterpret_cast<QRgb *>(image.scanLine(y));
        for (int x = 0; x < side; x++) {
            const double d = outside(QPointF(x + 0.5 - size, y + 0.5 - size), box, box, radius);
            line[x] = qRgba(0, 0, 0, shadowAlpha(d, size));
        }
    }
    shadow = std::make_shared<KDecoration3::DecorationShadow>();
    shadow->setPadding(QMarginsF(size, size, size, size));
    shadow->setInnerShadowRect(QRectF(corner, corner, 1, 1));
    shadow->setShadow(image);
    return shadow;
}

class Decoration;

// What tide's KWin script tells the decoration, at /org/tide/Decoration on
// KWin's own D-Bus name: a script can call D-Bus, and a decoration runs
// inside KWin. Windows go by KWin's UUID for them, a script's internalId.
class Registry : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.tide.Decoration")

public:
    static Registry *self()
    {
        static Registry *registry = nullptr;
        if (!registry) {
            registry = new Registry;
            if (!QDBusConnection::sessionBus().registerObject(QStringLiteral("/org/tide/Decoration"), registry, QDBusConnection::ExportScriptableSlots)) {
                qCWarning(TIDE) << "couldn't put /org/tide/Decoration on D-Bus, so tide's script can't say which sides of a tile drag, and every window resizes as a floating one";
            }
            registry->askScript();
        }
        return registry;
    }

    void add(const QUuid &id, Decoration *decoration)
    {
        m_decorations.insert(id, decoration);
    }

    void remove(const QUuid &id, Decoration *decoration)
    {
        if (m_decorations.value(id) == decoration) {
            m_decorations.remove(id);
        }
    }

    int edges(const QUuid &id) const
    {
        return m_edges.value(id, Floating);
    }

    // Has tide's script, if it's running, say every tile's sides again: it
    // may have spoken before there was a decoration to hear. A decoration
    // can't call a script, but can press its shortcut, as tide's layout
    // widget does: tide-announce, through KGlobalAccel, which is KWin's
    // own. With no script there's no such shortcut, and nothing happens.
    void askScript()
    {
        QDBusMessage press = QDBusMessage::createMethodCall(QStringLiteral("org.kde.kglobalaccel"), QStringLiteral("/component/kwin"),
                                                            QStringLiteral("org.kde.kglobalaccel.Component"), QStringLiteral("invokeShortcut"));
        press.setArguments({QStringLiteral("tide-announce")});
        // No answer is waited for: the script's own calls say it heard
        if (!QDBusConnection::sessionBus().send(press)) {
            qCWarning(TIDE) << "couldn't ask tide's script which sides of its tiles drag, so they resize as floating windows until it lays out again";
        }
    }

public Q_SLOTS:
    // The sides of tile `window` that a drag moves, as Qt::Edges, or 0 for
    // none; -1 for a window that isn't a tile, or is gone.
    Q_SCRIPTABLE void setEdges(const QString &window, int edges);
    // Forgets every tile, as tide's script asks when it starts: what one
    // before it said no longer holds.
    Q_SCRIPTABLE void reset();
    // What the decoration has for `window`, as JSON, for the tests and for
    // looking: {zone: [left, top, right, bottom], shadow, borders, radius,
    // edges}. Empty for a window with no tide decoration.
    Q_SCRIPTABLE QString describe(const QString &window) const;

private:
    void watchScripts();
    void scriptGone();
    void forget();

    QHash<QUuid, Decoration *> m_decorations;
    // Kept apart from the decorations: KWin makes a window's again as its
    // settings change.
    QHash<QUuid, int> m_edges;
    // KWin's scripts, each watched for its going
    QPointer<QObject> m_scripting;
    QSet<QObject *> m_scripts;
};

class Button : public KDecoration3::DecorationButton
{
    Q_OBJECT

public:
    Button(DecorationButtonType type, KDecoration3::Decoration *decoration, QObject *parent)
        : DecorationButton(type, decoration, parent)
    {
    }

    // The buttons tide draws: KWin's defaults. Any other is left out.
    static KDecoration3::DecorationButton *create(DecorationButtonType type, KDecoration3::Decoration *decoration, QObject *parent)
    {
        switch (type) {
        case DecorationButtonType::Menu:
        case DecorationButtonType::OnAllDesktops:
        case DecorationButtonType::Minimize:
        case DecorationButtonType::Maximize:
        case DecorationButtonType::Close:
            return new Button(type, decoration, parent);
        default:
            return nullptr;
        }
    }

    void paint(QPainter *painter, const QRectF &) override
    {
        if (!isVisible()) {
            return;
        }
        const auto *window = decoration()->window();
        const QRectF g = geometry();
        const QColor text = window->color(window->isActive() ? ColorGroup::Active : ColorGroup::Inactive, ColorRole::Foreground);
        painter->save();
        painter->setRenderHint(QPainter::Antialiasing);
        if (isHovered() || isPressed()) {
            QColor back = type() == DecorationButtonType::Close ? QColor(0xda, 0x44, 0x53) : text;
            back.setAlphaF(type() == DecorationButtonType::Close ? 1.0 : (isPressed() ? 0.3 : 0.15));
            painter->setPen(Qt::NoPen);
            painter->setBrush(back);
            painter->drawRoundedRect(g.adjusted(1, 1, -1, -1), 3, 3);
        }
        if (type() == DecorationButtonType::Menu) {
            const double side = std::min(g.width(), g.height()) * 0.7;
            window->icon().paint(painter, QRectF(g.center() - QPointF(side / 2, side / 2), QSizeF(side, side)).toRect());
            painter->restore();
            return;
        }
        QColor ink = isEnabled() ? text : QColor(text.red(), text.green(), text.blue(), 0x60);
        painter->setPen(QPen(ink, 1.2));
        painter->setBrush(Qt::NoBrush);
        const double r = std::min(g.width(), g.height()) * 0.18;
        const QPointF c = g.center();
        switch (type()) {
        case DecorationButtonType::Close:
            painter->drawLine(c + QPointF(-r, -r), c + QPointF(r, r));
            painter->drawLine(c + QPointF(-r, r), c + QPointF(r, -r));
            break;
        case DecorationButtonType::Maximize:
            painter->drawRect(QRectF(c - QPointF(r, r), QSizeF(2 * r, 2 * r)));
            if (isChecked()) {
                painter->drawLine(c + QPointF(-r, -r / 3), c + QPointF(r, -r / 3));
            }
            break;
        case DecorationButtonType::Minimize:
            painter->drawLine(c + QPointF(-r, r), c + QPointF(r, r));
            break;
        case DecorationButtonType::OnAllDesktops:
            painter->setBrush(isChecked() ? QBrush(ink) : Qt::NoBrush);
            painter->drawEllipse(c, r * 0.8, r * 0.8);
            break;
        default:
            break;
        }
        painter->restore();
    }
};

class Decoration : public KDecoration3::Decoration
{
    Q_OBJECT

public:
    explicit Decoration(QObject *parent = nullptr, const QVariantList &args = QVariantList())
        : KDecoration3::Decoration(parent, args)
    {
        // KWin makes a decoration with its window as the parent
        // (DecorationBridge::createDecoration), which has the UUID a script
        // knows it by. Elsewhere, as in a preview, there's none.
        if (parent) {
            m_id = parent->property("internalId").toUuid();
        }
    }

    ~Decoration() override
    {
        if (!m_id.isNull()) {
            Registry::self()->remove(m_id, this);
        }
    }

    bool init() override
    {
        m_settings = readSettings();
        if (!m_id.isNull()) {
            Registry::self()->add(m_id, this);
        }
        m_left = new KDecoration3::DecorationButtonGroup(KDecoration3::DecorationButtonGroup::Position::Left, this, &Button::create);
        m_right = new KDecoration3::DecorationButtonGroup(KDecoration3::DecorationButtonGroup::Position::Right, this, &Button::create);

        const auto *w = window();
        const auto refresh = [this] {
            this->refresh();
        };
        connect(w, &KDecoration3::DecoratedWindow::activeChanged, this, refresh);
        connect(w, &KDecoration3::DecoratedWindow::maximizedChanged, this, refresh);
        connect(w, &KDecoration3::DecoratedWindow::resizeableChanged, this, refresh);
        connect(w, &KDecoration3::DecoratedWindow::sizeChanged, this, refresh);
        connect(w, &KDecoration3::DecoratedWindow::captionChanged, this, [this] {
            update();
        });
        connect(w, &KDecoration3::DecoratedWindow::paletteChanged, this, [this] {
            update();
        });
        connect(settings().get(), &KDecoration3::DecorationSettings::reconfigured, this, [this] {
            m_settings = readSettings();
            this->refresh();
        });
        connect(settings().get(), &KDecoration3::DecorationSettings::fontChanged, this, refresh);
        connect(settings().get(), &KDecoration3::DecorationSettings::spacingChanged, this, refresh);
        connect(settings().get(), &KDecoration3::DecorationSettings::decorationButtonsLeftChanged, this, refresh);
        connect(settings().get(), &KDecoration3::DecorationSettings::decorationButtonsRightChanged, this, refresh);
        refresh();
        return true;
    }

    // The window as zones.h takes it
    Window state() const
    {
        Window w;
        w.active = window()->isActive();
        w.maximized = window()->isMaximized();
        w.resizable = window()->isResizeable();
        w.edges = m_id.isNull() ? Floating : Registry::self()->edges(m_id);
        return w;
    }

    // Sets the borders, the zone, the shadow and the corners for the
    // settings and the window as they are now.
    void refresh()
    {
        const Window w = state();
        const double bar = m_settings.titleBar ? std::ceil(QFontMetricsF(settings()->font()).height()) + 2 * settings()->smallSpacing() : 0;
        const double border = w.maximized ? 0 : m_settings.borderWidth;
        setBorders(QMarginsF(border, bar > 0 ? bar : border, border, border));
        setTitleBar(QRectF(0, 0, size().width(), bar));
        const Margins z = zone(m_settings, w);
        setResizeOnlyBorders(QMarginsF(z.left, z.top, z.right, z.bottom));
        const int radius = m_settings.roundedCorners && !w.maximized ? Rounding : 0;
        setBorderRadius(KDecoration3::BorderRadius(radius));
        setOpaque(radius == 0);
        setShadow(castsShadow(m_settings, w) ? shadowFor(m_settings.shadowSize, radius) : nullptr);

        const double side = bar;
        for (auto *group : {m_left, m_right}) {
            for (auto *button : group->buttons()) {
                button->setGeometry(QRectF(0, 0, side, side));
            }
            group->setSpacing(0);
        }
        m_left->setPos(QPointF(border, 0));
        m_right->setPos(QPointF(size().width() - border - m_right->geometry().width(), 0));
        update();
    }

    void paint(QPainter *painter, const QRectF &) override
    {
        const auto *w = window();
        const QRectF frame = rect();
        const double radius = borderRadius().topLeft();
        painter->save();
        painter->setRenderHint(QPainter::Antialiasing);
        if (radius > 0) {
            QPainterPath shape;
            shape.addRoundedRect(frame, radius, radius);
            painter->setClipPath(shape);
        }
        const ColorGroup group = w->isActive() ? ColorGroup::Active : ColorGroup::Inactive;
        const QColor back = w->color(group, ColorRole::TitleBar);
        // The border is surface-3 of tide's palette, dark or light as
        // Plasma's colors are.
        const QColor edge = back.lightness() < 128 ? BorderDark : BorderLight;
        painter->fillRect(frame, m_settings.borderWidth > 0 ? edge : back);
        const QRectF bar = titleBar();
        if (!bar.isEmpty()) {
            painter->fillRect(bar, back);
            m_left->paint(painter, frame);
            m_right->paint(painter, frame);
            const double left = m_left->geometry().right() + settings()->smallSpacing();
            const double right = m_right->geometry().left() - settings()->smallSpacing();
            if (right > left) {
                painter->setFont(settings()->font());
                painter->setPen(w->color(group, ColorRole::Foreground));
                const QRectF room(left, bar.top(), right - left, bar.height());
                const QString caption = painter->fontMetrics().elidedText(w->caption(), Qt::ElideMiddle, int(room.width()));
                // Centered on the window where it fits, as Plasma's is
                const QRectF whole(bar.left(), bar.top(), bar.width(), bar.height());
                const double width = painter->fontMetrics().horizontalAdvance(caption);
                const bool fits = whole.center().x() - width / 2 >= left && whole.center().x() + width / 2 <= right;
                painter->drawText(fits ? whole : room, Qt::AlignCenter, caption);
            }
        }
        painter->restore();
    }

    QJsonObject describe() const
    {
        const QMarginsF z = resizeOnlyBorders();
        const QMarginsF b = borders();
        const auto list = [](const QMarginsF &m) {
            return QJsonArray{m.left(), m.top(), m.right(), m.bottom()};
        };
        return QJsonObject{
            {QStringLiteral("zone"), list(z)},
            {QStringLiteral("borders"), list(b)},
            {QStringLiteral("shadow"), shadow() ? int(shadow()->paddingLeft()) : 0},
            {QStringLiteral("radius"), borderRadius().topLeft()},
            {QStringLiteral("edges"), state().edges},
            {QStringLiteral("section"), int(sectionUnderMouse())},
        };
    }

protected:
    // KDecoration picks the side or corner a drag takes from where the
    // pointer is. A tile's sides drag whole, and only some (zones.h).
    void hoverEnterEvent(QHoverEvent *event) override
    {
        QHoverEvent moved = placed(event);
        KDecoration3::Decoration::hoverEnterEvent(&moved);
    }

    void hoverMoveEvent(QHoverEvent *event) override
    {
        QHoverEvent moved = placed(event);
        KDecoration3::Decoration::hoverMoveEvent(&moved);
    }

private:
    QHoverEvent placed(const QHoverEvent *event) const
    {
        const QMarginsF b = borders();
        const Point p = sectionPoint({event->position().x(), event->position().y()}, size().width(), size().height(),
                                     Margins{int(b.left()), int(b.top()), int(b.right()), int(b.bottom())}, !titleBar().isEmpty(), state().edges);
        const QPointF at(p.x, p.y);
        return QHoverEvent(event->type(), at, event->globalPosition() + (at - event->position()), event->oldPosF(), event->modifiers());
    }

    QUuid m_id;
    Settings m_settings;
    KDecoration3::DecorationButtonGroup *m_left = nullptr;
    KDecoration3::DecorationButtonGroup *m_right = nullptr;
};

void Registry::setEdges(const QString &window, int edges)
{
    const QUuid id = QUuid::fromString(window);
    if (id.isNull() || edges < Floating || edges > (Top | Left | Right | Bottom)) {
        qCWarning(TIDE) << "setEdges: no such window or sides:" << window << edges;
        return;
    }
    if (edges == Floating) {
        m_edges.remove(id);
    } else {
        m_edges.insert(id, edges);
    }
    if (Decoration *decoration = m_decorations.value(id)) {
        decoration->refresh();
    }
    watchScripts();
}

// KWin tells a script nothing as it stops: it deletes it (KWin's
// Scripting::unloadScript, AbstractScript::stop). So tide's script can't
// say that its tiles are tiles no more, and the decoration watches for it
// going instead. KWin's scripts are the children of its Scripting object,
// which is the one at /Scripting on D-Bus. None says which script it is,
// so as any goes, Scripting is asked whether tide's is still loaded.
void Registry::watchScripts()
{
    if (!m_scripting) {
        m_scripting = QDBusConnection::sessionBus().objectRegisteredAt(QStringLiteral("/Scripting"));
        if (!m_scripting) {
            qCWarning(TIDE) << "KWin has nothing at /Scripting, so if tide's script stops, its tiles keep their zones until KWin restarts";
            return;
        }
    }
    const auto children = m_scripting->children();
    for (QObject *script : children) {
        if (!script->inherits("KWin::AbstractScript") || m_scripts.contains(script)) {
            continue;
        }
        m_scripts.insert(script);
        connect(script, &QObject::destroyed, this, [this](QObject *gone) {
            m_scripts.remove(gone);
            // Once KWin is done with it: as KWin itself stops, never
            QMetaObject::invokeMethod(this, &Registry::scriptGone, Qt::QueuedConnection);
        });
    }
}

// With tide's script gone, every window is a floating one again.
void Registry::scriptGone()
{
    if (!m_scripting || m_edges.isEmpty()) {
        return;
    }
    bool loaded = false;
    if (!QMetaObject::invokeMethod(m_scripting, "isScriptLoaded", Q_RETURN_ARG(bool, loaded), Q_ARG(QString, QStringLiteral("tide")))) {
        qCWarning(TIDE) << "couldn't ask KWin whether tide's script is loaded, so its tiles keep their zones";
        return;
    }
    if (loaded) {
        return;
    }
    qCInfo(TIDE) << "tide's script stopped, so every window resizes as a floating one";
    forget();
}

void Registry::reset()
{
    forget();
    watchScripts();
}

void Registry::forget()
{
    if (m_edges.isEmpty()) {
        return;
    }
    m_edges.clear();
    for (Decoration *decoration : std::as_const(m_decorations)) {
        decoration->refresh();
    }
}

QString Registry::describe(const QString &window) const
{
    const Decoration *decoration = m_decorations.value(QUuid::fromString(window));
    if (!decoration) {
        return QString();
    }
    return QString::fromUtf8(QJsonDocument(decoration->describe()).toJson(QJsonDocument::Compact));
}

} // namespace Tide

K_PLUGIN_FACTORY_WITH_JSON(TideDecorationFactory, "metadata.json", registerPlugin<Tide::Decoration>();)

#include "decoration.moc"
