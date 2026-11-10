// The layout symbol tide's bar shows (tide SPEC.md §6.1, §7.1), in
// Plasma's panel: the layout of the workspace on this panel's monitor,
// which tide's KWin script sets as it changes. A click is the next
// layout there, as tide's Meta+. is for the window you're in.
import QtQuick
import QtQuick.Layouts
import QtQuick.Window
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.workspace.dbus as DBus

PlasmoidItem {
    id: root

    readonly property var layouts: {
        try {
            return JSON.parse(Plasmoid.configuration.layouts);
        } catch (e) {
            console.warn(`tide-layout: the layouts tide wrote don't parse (${e}), so none shows`);
            return {};
        }
    }
    readonly property var here: layouts[Screen.name] ?? null
    readonly property string symbol: here ? here.symbol : ""
    readonly property var names: ({ tile: "Tile", threecol: "Three columns", twocol: "Two columns", monocle: "Monocle" })

    preferredRepresentation: fullRepresentation
    toolTipMainText: here ? (names[here.mode] ?? here.mode) : "tide"
    toolTipSubText: here ? "Click for the next layout" : "tide's KWin script hasn't said this monitor's layout"

    onSymbolChanged: console.log(`tide-layout: ${Screen.name} ${symbol}`)
    // tide writes the layouts as they change, so one just added, or a
    // Plasma just restarted, asks for them now.
    Component.onCompleted: shortcut("tide-announce")

    function shortcut(name) {
        DBus.SessionBus.asyncCall({
            service: "org.kde.kglobalaccel",
            path: "/component/kwin",
            iface: "org.kde.kglobalaccel.Component",
            member: "invokeShortcut",
            arguments: [name],
        });
    }

    fullRepresentation: PlasmaComponents.Label {
        text: root.symbol === "" ? "[?]" : root.symbol
        font.family: "monospace"
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        Layout.minimumWidth: implicitWidth

        MouseArea {
            anchors.fill: parent
            onClicked: root.shortcut("tide-next-layout-here")
        }
    }
}
