# tide-kde: tide's layouts, workspaces and keys as a KWin script.
#
#   make              build the script, package/contents/code/main.js
#   make lint         every script parses
#   make test         the unit tests (Node)
#   make test-kwin    the script and the decoration in a headless KWin
#                     (tests/kwin/); needs what README.md's Development lists
#   make decoration   build tide's window decoration (decoration/), a KWin
#                     plugin in C++; needs what README.md's Decoration lists
#   make test-zones   the decoration's rules (decoration/zones.h), with only
#                     a C++ compiler
#   make install-decoration  install the decoration for this user;
#                     `make uninstall-decoration` takes it out
#   make check-tideco compare the copied geometry and defaults check with
#                     a tide for Chrome checkout (TIDECO=../tideco by default)
#   make check-tide-defaults  compare the defaults that restate tide's with
#                     a tide checkout (TIDE=../tide by default)
#   make check-tide-reopened  compare the copied reopened windows' rules
#                     with a tide checkout
#   make dist         dist/tide.kwinscript, for KWin's "Install from File",
#                     and dist/tide-layout.plasmoid, the layout widget
#   make install      install both for this user, turn the script on, and
#                     have KWin load it; `make uninstall` takes them out
#   make install-report-bug  install the unit Meta+Shift+B starts to report
#                     a bug, as install and setup do
#   make setup        free Plasma's keys that tide's take, set dimming and
#                     focus stealing prevention, put the layout widget on
#                     the panel (scripts/setup.mjs), and install-report-bug

TIDECO ?= ../tideco
TIDE ?= ../tide
SCRIPT = package/contents/code/main.js
SRC = $(filter-out %_test.js %_test.mjs src/fake_kwin.js,$(wildcard src/*.js src/*.mjs))

# Every test file runs from here. `make test` fails if a *_test.js isn't
# listed, since an unlisted test never runs.
TESTS = \
	src/cycle_test.js \
	src/direction_test.js \
	src/geometry_test.js \
	src/layout_test.js \
	src/reopened_test.mjs \
	src/settings_test.js \
	src/tide_test.js \
	src/workspaces_test.js \
	scripts/bundle_test.mjs \
	scripts/check-tide-defaults_test.mjs \
	scripts/install_test.mjs \
	scripts/setup_test.mjs \
	scripts/tidedefaults_test.mjs

# The decoration builds under build/, and installs into this Qt plugin
# directory, the user's own. Plasma's session finds it through
# QT_PLUGIN_PATH, which ENV_SCRIPT sets as the session starts.
PLUGIN_DIR ?= $(HOME)/.local/lib/qt6/plugins
ENV_DIR ?= $(or $(XDG_CONFIG_HOME),$(HOME)/.config)/plasma-workspace/env
ENV_SCRIPT = $(ENV_DIR)/tide-kde.sh
DECORATION = build/decoration/plugins/org.kde.kdecoration3/org.tide.decoration.so
FAKE_INPUT ?= /usr/share/plasma-wayland-protocols/fake-input.xml
# Report a bug (SPEC.md §4.9): the script it runs, and the user unit the
# KWin script has systemd start.
REPORT_BUG ?= $(or $(XDG_DATA_HOME),$(HOME)/.local/share)/tide-kde/tide-kde-report-bug
UNIT_DIR ?= $(or $(XDG_CONFIG_HOME),$(HOME)/.config)/systemd/user
UNIT = $(UNIT_DIR)/tide-kde-report-bug.service

.PHONY: all lint test test-kwin test-zones decoration install-decoration uninstall-decoration check-tideco check-tide-defaults check-tide-reopened dist install uninstall install-report-bug uninstall-report-bug setup version unshallow-check clean

all: $(SCRIPT)

$(SCRIPT): $(SRC) scripts/bundle.mjs
	mkdir -p $(dir $@)
	node scripts/bundle.mjs src/main.js > $@.tmp && mv $@.tmp $@

lint:
	@for f in src/*.js src/*.mjs scripts/*.mjs tests/kwin/probe.js; do node --check "$$f" || exit 1; done
	sh -n bin/tide-kde-report-bug
	python3 -m py_compile tests/kwin/*.py

test:
	@unlisted=$$(find src scripts -name '*_test.*js' | sort | while read -r f; do \
		case " $(TESTS) " in *" $$f "*) ;; *) echo "$$f";; esac; done); \
	if test -n "$$unlisted"; then echo "not in the Makefile's TESTS: $$unlisted" >&2; exit 1; fi
	node --test $(TESTS)
	sh bin/tide-kde-report-bug_test.sh

test-kwin: $(SCRIPT) decoration build/pointer
	cd tests/kwin && dbus-run-session -- python3 -m unittest discover -v

decoration: $(DECORATION)

$(DECORATION): decoration/CMakeLists.txt decoration/decoration.cpp decoration/zones.h decoration/metadata.json
	cmake -S decoration -B build/decoration -DCMAKE_BUILD_TYPE=RelWithDebInfo
	cmake --build build/decoration

test-zones:
	mkdir -p build
	$(CXX) -std=c++20 -Wall -Wextra -Werror decoration/zones_test.cpp -o build/zones_test
	build/zones_test

# The tests' pointer, over KWin's fake input protocol.
build/pointer: tests/kwin/pointer.c $(FAKE_INPUT)
	mkdir -p build
	wayland-scanner client-header $(FAKE_INPUT) build/fake-input-client-protocol.h
	wayland-scanner private-code $(FAKE_INPUT) build/fake-input-protocol.c
	$(CC) -Wall -Wextra -Werror -Ibuild tests/kwin/pointer.c build/fake-input-protocol.c -o $@ $$(pkg-config --cflags --libs wayland-client)

check-tideco:
	cmp $(TIDECO)/src/geometry.js src/geometry.js
	cmp $(TIDECO)/src/geometry_test.js src/geometry_test.js
	cmp $(TIDECO)/scripts/tidedefaults.mjs scripts/tidedefaults.mjs
	cmp $(TIDECO)/scripts/tidedefaults_test.mjs scripts/tidedefaults_test.mjs

# The defaults tide on KDE restates (the layouts, the main share's bounds,
# the standing workspaces, the decoration's shadow colors) are still tide's. Deliberate differences are
# listed in the script.
check-tide-defaults:
	node scripts/check-tide-defaults.mjs $(TIDE)

# Reopened windows go back to their desktops by tide's own rules, copied.
check-tide-reopened:
	cmp $(TIDE)/shell/lib/reopened.mjs src/reopened.mjs
	cmp $(TIDE)/shell/lib/reopened_test.mjs src/reopened_test.mjs

# The version is the number of commits, so each push to main is a higher
# one, released by CI as v<version>.
version: unshallow-check
	@git rev-list --count HEAD

# A shallow clone counts only the commits it has, which would make a lower
# version than one already released.
unshallow-check:
	@if test "$$(git rev-parse --is-shallow-repository)" != false; then \
		echo "the history is shallow, so the commit count is wrong; run git fetch --unshallow" >&2; exit 1; fi

# The packages with their version: fresh copies under dist/, zipped.
dist: $(SCRIPT) unshallow-check
	rm -rf dist/tide dist/tide-layout dist/tide.kwinscript dist/tide-layout.plasmoid
	mkdir -p dist && cp -R package dist/tide && cp -R plasmoid dist/tide-layout
	v=$$(git rev-list --count HEAD) && for m in dist/tide/metadata.json dist/tide-layout/metadata.json; do \
		sed -i.bak "s/\"Version\": \"0\"/\"Version\": \"$$v\"/" $$m && rm $$m.bak || exit 1; done
	cd dist/tide && zip -qr ../tide.kwinscript .
	cd dist/tide-layout && zip -qr ../tide-layout.plasmoid .

# Has a running KWin reload its scripts. Where KWin isn't running (setup run
# from a console or another desktop), there's nothing to reload: Plasma's
# next login loads what's installed.
RELOAD_KWIN = if qdbus6 org.kde.KWin >/dev/null 2>&1; then qdbus6 org.kde.KWin /KWin reconfigure; \
	else echo "KWin isn't running, so tide loads at the next Plasma login"; fi

# Has your systemd read the units again. Where it isn't running for you,
# it reads them as it starts.
RELOAD_SYSTEMD = if ! systemctl --user daemon-reload 2>/dev/null; then \
	echo "systemd isn't running for you, so reporting a bug works from the next login"; fi

install: $(SCRIPT) install-report-bug
	kpackagetool6 --type KWin/Script --upgrade package 2>/dev/null || kpackagetool6 --type KWin/Script --install package
	kpackagetool6 --type Plasma/Applet --upgrade plasmoid 2>/dev/null || kpackagetool6 --type Plasma/Applet --install plasmoid
	kwriteconfig6 --file kwinrc --group Plugins --key tideEnabled true
	@$(RELOAD_KWIN)

# The decoration, for this user: KWin loads it at the next login, once
# `make setup` has chosen it.
install-decoration: decoration
	cmake --install build/decoration --prefix $(PLUGIN_DIR)
	mkdir -p $(ENV_DIR)
	printf '%s\n' "# Written by tide-kde: where KWin finds tide's window decoration." \
		'export QT_PLUGIN_PATH="$(PLUGIN_DIR)$${QT_PLUGIN_PATH:+:$$QT_PLUGIN_PATH}"' > $(ENV_SCRIPT)

uninstall-decoration:
	rm -f $(PLUGIN_DIR)/org.kde.kdecoration3/org.tide.decoration.so $(ENV_SCRIPT)

setup: install-report-bug
	node scripts/setup.mjs

# Report a bug's script and the unit that runs it, for this user.
install-report-bug:
	mkdir -p "$(dir $(REPORT_BUG))" "$(UNIT_DIR)"
	install -m 755 bin/tide-kde-report-bug "$(REPORT_BUG)"
	sed 's|@REPORT_BUG@|$(REPORT_BUG)|' systemd/tide-kde-report-bug.service.in >"$(UNIT)"
	@$(RELOAD_SYSTEMD)

uninstall-report-bug:
	rm -f "$(UNIT)" "$(REPORT_BUG)"
	@$(RELOAD_SYSTEMD)

uninstall: uninstall-report-bug
	kwriteconfig6 --file kwinrc --group Plugins --key tideEnabled false
	@$(RELOAD_KWIN)
	kpackagetool6 --type KWin/Script --remove tide
	kpackagetool6 --type Plasma/Applet --remove org.tide.layout

clean:
	rm -rf dist build $(SCRIPT)
