# Verification record

Checks executed in the development workspace:

- Backend: `.venv/bin/python -m pytest server/tests -q` — 23 passed.
- Extension sync: `node extension/tests/sync.test.cjs` — 21 passed using mocked bookmark/storage/alarm/HTTP APIs.
- Popup: `node extension/tests/popup.test.cjs` — 6 passed using a mocked extension page, including connect gating, confirmation cancellation, and rename behavior.
- JavaScript syntax checks, Python compilation, and browser extension package generation succeeded.
- `docker compose config --quiet` succeeded.

The backend suite ran on Python 3.14; the Docker image targets Python 3.12. Dependencies were installed from existing local package caches because network package downloads were unavailable in this session.

A Docker container was **not launched**: access to `/var/run/docker.sock` was denied. Real Chrome and Firefox acceptance checks were **not executed**. Follow [browser-checks.md](browser-checks.md) with disposable profiles before using your main bookmarks. Automated mocks verify the portable-tree logic and synchronization state machine, not native browser compatibility.

Firefox timer regression: a Window-like timer receiver test reproduces the reported illegal invocation and verifies connection persistence and profile binding after the fix. This is an automated simulation; the fix still needs confirmation in Firefox.
