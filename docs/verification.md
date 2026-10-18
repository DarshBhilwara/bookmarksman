# Verification record

Checks executed in the development workspace:

- Backend: `.venv/bin/python -m pytest server/tests -q` — 23 passed.
- Extension sync: `node extension/tests/sync.test.cjs` — 27 passed using mocked bookmark/storage/alarm/HTTP APIs.
- Popup: `node extension/tests/popup.test.cjs` — 7 passed using a mocked extension page, including connect gating, confirmation cancellation, and rename behavior.
- JavaScript syntax checks, Python compilation, and browser extension package generation succeeded.
- `docker compose config --quiet` succeeded.

The backend suite ran on Python 3.14; the Docker image targets Python 3.12. Dependencies were installed from existing local package caches because network package downloads were unavailable in this session.

A Docker container was **not launched**: access to `/var/run/docker.sock` was denied. Real Chrome and Firefox acceptance checks were **not executed**. Follow [browser-checks.md](browser-checks.md) with disposable profiles before using your main bookmarks. Automated mocks verify the portable-tree logic and synchronization state machine, not native browser compatibility.

Firefox receiver regression: a Window-like fetch/timer test reproduces the reported illegal invocations and verifies the default browser fetch, injected fetch, connection persistence, and profile binding after the fixes. This is an automated simulation; the fix still needs confirmation in Firefox.

Connection diagnostics tests distinguish a missing host grant from a browser NetworkError, include the failing endpoint, and verify failed connection does not create a profile. They do not establish reachability of a deployed VPN server.

Firefox HTTP policy fix: the user's browser console confirmed CSP upgrading the configured HTTP health request to HTTPS. Added an explicit extension-pages policy that omits that upgrade. Rebuilt the packages and verified source, generated Firefox manifest, and packaged ZIP contain the same policy. Runtime verification of the updated Firefox policy remains pending.

Remembered settings checks: fresh background engine reads stored server/profile, offline popup preloads them before networking, failed reconnects preserve the successful binding, legacy server switching migrates its history, and repeated local recovery/import leaves sync history intact.

Docker Hub preparation: 9 publishing-script unit tests passed; local and published-image Compose configurations validated. Checked that both use identical persistent volume names and port settings and that the published-image configuration rejects a missing image. Dry runs covered host builds, single-platform local Buildx loads, and multi-platform pushes without invoking Docker. A daemon access check still returned permission denied; no release image was built, tested in a container, or pushed to Docker Hub in this session. Extensions remain in the repository.
