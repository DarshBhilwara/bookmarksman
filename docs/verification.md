# Testing and verification

This page explains how to check a local copy of bookmarksman and what the automated tests cover. Automated tests use mocked browser APIs; only a real browser can confirm behavior in a particular Chrome or Firefox release. Follow [the browser checklist](browser-checks.md) before relying on the extension with important bookmarks.

## Run automated checks

Install Python 3 and Node.js. From the repository root on Linux or macOS, create a Python environment, install the server test dependencies, and run the backend and extension tests:

```sh
python -m venv .venv
.venv/bin/pip install -r server/requirements-dev.txt
.venv/bin/python -m pytest server/tests -q
node extension/tests/sync.test.cjs
node extension/tests/popup.test.cjs
python -m unittest discover -s tools/tests -p 'test_*.py'
```

Backend tests cover API validation, JSON persistence, atomic storage, and concurrent revision checks. Extension tests simulate bookmark, storage, alarm, network, and popup APIs. They are useful for regressions but do not exercise real browser permissions, root layouts, suspension, or user interface behavior.

To check image publishing helper tests and the published-image Compose file, see the commands in [the Docker Hub guide](DOCKERHUB.md). A Compose configuration check does not build or run a Docker image.

## Manual browser validation

Use disposable Chrome and Firefox profiles, turn off each browser's native bookmark sync, and export an independent bookmark backup first. Check import, binding to an existing collection, nested and empty folders, ordering, cross-browser root fallbacks, upload and polling, offline retry, conflicts, recovery after interrupted restore, and profile switching. The [manual browser checklist](browser-checks.md) gives the steps.

Record browser and operating system versions and any failed steps when reporting a problem. Do not infer browser compatibility from mocked test results alone.
