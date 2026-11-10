PYTHON ?= python3
NODE ?= node
UUID := monitor-workspaces@local
ARCHIVE := dist/$(UUID).shell-extension.zip

.PHONY: help build test integration install

help:
	@echo 'make build        Create an installable extension in dist/'
	@echo 'make test         Run syntax, model, layout, stacking, and package checks'
	@echo 'make integration  Test in an isolated GNOME 42 desktop (requires GNOME)'
	@echo 'make install      Build and install into the current user profile'

build:
	$(PYTHON) scripts/build.py

test:
	@for file in src/*.js tests/*.js; do $(NODE) --check "$$file" || exit 1; done
	$(NODE) --test tests/*.test.js
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py' -v

integration:
	$(PYTHON) scripts/integration.py

install: build
	gnome-extensions install --force $(ARCHIVE)
	@echo 'Restart GNOME Shell, then run: gnome-extensions enable $(UUID)'
