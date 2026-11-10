# tide-kde: tide's layouts, workspaces and keys as a KWin script.
#
#   make              build the script, package/contents/code/main.js
#   make lint         every script parses
#   make test         the unit tests (Node)
#   make test-kwin    the script in a headless KWin (tests/kwin/); needs
#                     kwin_wayland, foot, qdbus6 and dbus-run-session
#   make check-tideco compare the copied geometry with a tide for Chrome
#                     checkout (TIDECO=../tideco by default)
#   make dist         dist/tide.kwinscript, for KWin's "Install from File",
#                     and dist/tide-layout.plasmoid, the layout widget
#   make install      install both for this user, turn the script on, and
#                     have KWin load it; `make uninstall` takes them out

TIDECO ?= ../tideco
SCRIPT = package/contents/code/main.js
SRC = $(filter-out %_test.js src/fake_kwin.js,$(wildcard src/*.js))

# Every test file runs from here. `make test` fails if a *_test.js isn't
# listed, since an unlisted test never runs.
TESTS = \
	src/direction_test.js \
	src/geometry_test.js \
	src/layout_test.js \
	src/settings_test.js \
	src/tide_test.js \
	src/workspaces_test.js \
	scripts/bundle_test.mjs

.PHONY: all lint test test-kwin check-tideco dist install uninstall version unshallow-check clean

all: $(SCRIPT)

$(SCRIPT): $(SRC) scripts/bundle.mjs
	mkdir -p $(dir $@)
	node scripts/bundle.mjs src/main.js > $@.tmp && mv $@.tmp $@

lint:
	@for f in src/*.js scripts/*.mjs tests/kwin/probe.js; do node --check "$$f" || exit 1; done
	python3 -m py_compile tests/kwin/*.py

test:
	@unlisted=$$(find src scripts -name '*_test.*js' | sort | while read -r f; do \
		case " $(TESTS) " in *" $$f "*) ;; *) echo "$$f";; esac; done); \
	if test -n "$$unlisted"; then echo "not in the Makefile's TESTS: $$unlisted" >&2; exit 1; fi
	node --test $(TESTS)

test-kwin: $(SCRIPT)
	cd tests/kwin && dbus-run-session -- python3 -m unittest discover -v

check-tideco:
	cmp $(TIDECO)/src/geometry.js src/geometry.js
	cmp $(TIDECO)/src/geometry_test.js src/geometry_test.js

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

install: $(SCRIPT)
	kpackagetool6 --type KWin/Script --upgrade package 2>/dev/null || kpackagetool6 --type KWin/Script --install package
	kpackagetool6 --type Plasma/Applet --upgrade plasmoid 2>/dev/null || kpackagetool6 --type Plasma/Applet --install plasmoid
	kwriteconfig6 --file kwinrc --group Plugins --key tideEnabled true
	qdbus6 org.kde.KWin /KWin reconfigure

uninstall:
	kwriteconfig6 --file kwinrc --group Plugins --key tideEnabled false
	qdbus6 org.kde.KWin /KWin reconfigure
	kpackagetool6 --type KWin/Script --remove tide
	kpackagetool6 --type Plasma/Applet --remove org.tide.layout

clean:
	rm -rf dist $(SCRIPT)
