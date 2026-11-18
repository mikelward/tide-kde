"""A stand-in for systemd's user manager on the session bus, for Report a
bug's tests: it answers LoadUnit, a unit's LoadState and StartUnit as
systemd does (its dbus-manager.c), for the units named on its command line,
and says each call on stdout. Run by test_tide.py; needs dbus-python and
PyGObject."""

import sys

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

UNITS = set(sys.argv[1:])
BASE = "/org/freedesktop/systemd1"


def escape(name):
    """A unit's name as systemd puts it in an object path (bus_label_escape)."""
    return "".join(c if c.isalnum() and c.isascii() else f"_{ord(c):02x}" for c in name)


def say(*words):
    print(*words, flush=True)


class Manager(dbus.service.Object):
    @dbus.service.method("org.freedesktop.systemd1.Manager", in_signature="s", out_signature="o")
    def LoadUnit(self, name):
        say("LoadUnit", name)
        # A unit with no file loads too, as not-found (manager_load_unit)
        return dbus.ObjectPath(f"{BASE}/unit/{escape(name)}")

    @dbus.service.method("org.freedesktop.systemd1.Manager", in_signature="ss", out_signature="o")
    def StartUnit(self, name, mode):
        say("StartUnit", name, mode)
        if name not in UNITS:
            raise dbus.exceptions.DBusException(f"Unit {name} not found.", name="org.freedesktop.systemd1.NoSuchUnit")
        return dbus.ObjectPath(f"{BASE}/job/1")


class Units(dbus.service.FallbackObject):
    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ss", out_signature="v", rel_path_keyword="path")
    def Get(self, interface, prop, path=None):
        say("Get", path, interface, prop)
        if interface != "org.freedesktop.systemd1.Unit" or prop != "LoadState":
            raise dbus.exceptions.DBusException(f"No property {prop}", name="org.freedesktop.DBus.Error.UnknownProperty")
        loaded = any("/" + escape(u) == path for u in UNITS)
        return dbus.String("loaded" if loaded else "not-found", variant_level=1)


def main():
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    Manager(bus, BASE)
    Units(bus, f"{BASE}/unit")
    # Takes the name last, so a caller waiting for it finds both objects
    name = dbus.service.BusName("org.freedesktop.systemd1", bus)
    say("ready", name.get_name())
    GLib.MainLoop().run()


if __name__ == "__main__":
    main()
