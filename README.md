# bookmarksman

A small personal self hosted bookmark synchronizer: one Python/FastAPI server, JSON files, and a Chrome/Firefox extension. Each installed browser profile chooses one named server collection. No accounts, cloud services, telemetry, or database.

**The API has no authentication. Anyone able to reach it can read and change every collection. Run it only on your trusted LAN or mesh VPN; do not expose it to the public internet.**

## Start the server

Requires Docker with Compose:

```sh
cp .env.example .env
docker compose up -d --build
curl http://localhost:8080/api/health
docker compose logs -f
docker compose down
```

The default published port is 8080. Edit `.env` to change the published port/address. Set the bind address to your VPN interface address if you only want VPN access. Persistent JSON files live in the Compose volume at `/data/profiles`, independently of container recreation. Do not run `docker compose down -v` unless you intend to delete the data.

## Install the extension

Requires Python 3 to copy the shared sources into browser-specific loadable directories:

```sh
python tools/build-extension.py
```

- Chrome desktop: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/bookmarksman-chrome`.
- Firefox desktop: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and open `dist/bookmarksman-firefox/manifest.json`. Temporary add-ons are removed on restart. For lasting installation in standard Firefox, package/sign through Mozilla's add-on signing process, or use a Firefox edition/policy that supports your own unsigned add-ons. Export recovery snapshots before temporary add-on removal or uninstalling.

Target minimum versions: Chrome 120 and Firefox 128. The extension shares its code; Chrome runs a Manifest V3 service worker and Firefox runs a Manifest V3 background event page. No content scripts or access to page contents are required. The `unlimitedStorage` permission allows local recovery snapshots and large trees to survive the ordinary extension-storage quota. Optional HTTP(S) host access is requested for the configured server scheme and host (all ports, as required by Firefox match patterns) when you click Connect. Use the same server address consistently.

## Configure once per browser profile

1. Open the bookmarksman popup, enter your server address, such as `http://100.100.10.10:8080`, and click **Connect**. Grant access to that server. Profile controls appear only after the connection succeeds.
2. Enter a profile name and click **Use profile**. If that name is new, bookmarksman creates it from the current browser's complete bookmark tree and starts syncing. If it already exists, the popup shows local/server bookmark counts and asks before replacing local bookmarks. A recovery snapshot is saved before replacement. There is no separate profile-creation step.
3. On another browser, connect to the same server, enter the existing collection name, and click **Use profile**. Confirm replacement after checking counts.
4. Automatic synchronization is enabled after binding. **Sync now** performs an immediate reconciliation. The popup shows the bound collection, status, last success, and server revision.

Names use 1–64 ASCII letters, digits, underscores, or hyphens. Each browser profile stores its own settings. To switch collections, enter another name and confirm replacement if it already exists. **Rename current profile** renames the server collection; browsers bound to the old name must select the new one. Disable Chrome Sync / Firefox Sync for bookmarks while using bookmarksman so two independent synchronization systems do not fight each other.

## Synchronization and recovery

Local bookmark events trigger a seven-second debounce and a complete-tree upload. A persistent alarm provides a fallback if the worker sleeps before the debounce runs; browsers can delay alarms, so seven seconds is a target while awake, not a strict guarantee. A five-minute alarm checks the server, and startup reconciles again. Unchanged trees are not rebuilt or re-uploaded. Offline changes remain pending and retry later. Where native bookmark-import events exist, uploads wait until import ends. If the background process restarts during native import, automatic sync pauses; enable it again after the browser finishes importing.

The server assigns Unix milliseconds as revisions, always greater than the previous revision. Updates must supply the revision the browser last synchronized. A stale write receives HTTP 409. **The latest committed server snapshot wins**: pending local bookmarks are saved in a recovery snapshot before the newer server tree is applied. No per-bookmark merge or client-clock comparison occurs.

Before remote replacement, a normalized local snapshot and operation state are persisted in extension storage. Restoration deletes only user descendants of recognized roots, then recreates nodes sequentially at explicit indices and verifies the result. A failure or interruption pauses automatic synchronization and preserves the recovery snapshot; use **Recovery snapshots** in the popup to export or restore it. Recovery is local and pauses automatic sync. Rebinding later explicitly replaces local bookmarks with server data, so import recovered bookmarks into a new collection if you want to preserve them on the server.

Recovery storage retains the ten latest snapshots and pins the original rollback tree while a failed restore is unresolved. Select a snapshot in the recovery dropdown to download it as a separate file. Extension removal or storage clearing can erase them. Keep independent server and browser backups. Avoid editing bookmarks during a remote replacement: replacement is a snapshot operation, not a merge, and concurrent edits can make verification fail.

## Portable roots and ordering

The server format has four ordered arrays: `toolbar`, `menu`, `other`, and `mobile`. Bookmark/folder titles (including empty titles), URLs, nested children, empty folders, and sibling array order are preserved. Browser IDs never enter the portable tree. Permanent browser root names remain browser controlled.

The extension maps browser roots explicitly rather than translating localized display names. Unsupported categories are represented by reserved wrapper folders under Other bookmarks; for example `[bookmarksman-root:menu]` and `[bookmarksman-root:mobile]`. These wrappers are unwrapped on export, so repeated Chrome–Firefox round trips preserve categories rather than nesting duplicate wrappers. Keep those wrapper names intact. Firefox separators use the reserved empty-folder marker `[bookmarksman:separator]` in Chrome, because Chrome cannot create native separators. Reserved marker names are for bookmarksman; do not use them for ordinary folders.

Unknown, managed, or ambiguous duplicate roots are refused before destructive replacement instead of guessing and risking loss. Chrome account-managed bookmark layouts may therefore need native sync disabled and bookmarks moved into one ordinary root set first. Favicons are left to the browser and are not synchronized. Native browser support for bookmark URL schemes can differ; a rejected create pauses restoration with a recoverable snapshot.

## API

All endpoints are under `/api`:

| Method | Path | Request |
| --- | --- | --- |
| GET | `/health` | — |
| GET | `/profiles` | — |
| GET | `/profiles/{name}` | — |
| POST | `/profiles/{name}` | `{ "tree": ... }` |
| PUT | `/profiles/{name}` | `{ "base_updated_at": 123, "tree": ... }` |
| POST | `/profiles/{name}/rename` | `{ "name": "new-name", "base_updated_at": 123 }` |

A profile contains `schema_version: 1`, `name`, `updated_at`, and `tree`. The tree shape is:

```json
{
  "roots": {
    "toolbar": [
      {"type": "bookmark", "title": "Example", "url": "https://example.com"},
      {"type": "folder", "title": "Empty folder", "children": []}
    ],
    "menu": [], "other": [], "mobile": []
  }
}
```

Separators use `{"type":"separator"}`. The server validates requests, bounds tree complexity and payload size, serializes writes under a filesystem lock, and atomically replaces JSON files. Keep the data volume on a local filesystem with working file locks and atomic rename. HTTP 404 means missing profile, 409 means duplicate name/stale revision, and validation/storage errors have explicit responses. Corrupted files are reported rather than silently replaced.

## Tests and browser verification

```sh
python -m venv .venv
.venv/bin/pip install -r server/requirements-dev.txt
.venv/bin/python -m pytest server/tests -q
node extension/tests/sync.test.cjs
node extension/tests/popup.test.cjs
```

Automated tests exercise backend storage/concurrency and extension logic with mocked browser APIs. For actual browser acceptance, follow [the manual checklist](docs/browser-checks.md), especially cross-browser round trips, worker interruption, and partial restore recovery. Mock tests are not proof of real browser compatibility.

For direct server development, set `BOOKMARKSMAN_DATA` to a writable folder and run:

```sh
BOOKMARKSMAN_DATA=./data/profiles .venv/bin/uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8080
```

## Backups

Stop the service for a consistent copy of all collections. These commands stream the named volume through the application image, so the container does not need access to your host backup directory:

```sh
docker compose stop
docker compose run --rm --no-deps -T bookmarksman python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz'); t.add('/data/profiles',arcname='profiles'); t.close()" > bookmarksman-data.tar.gz
docker compose up -d
```

To restore a **trusted** backup (this replaces matching files; use a clean volume if you need an exact full restore):

```sh
docker compose stop
docker compose run --rm --no-deps -T bookmarksman python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz'); t.extractall('/data',filter='data'); t.close()" < bookmarksman-data.tar.gz
docker compose up -d
```

JSON files can also be copied individually while stopped. Keep backups private: bookmark URLs can contain sensitive information.

API compatibility references used during implementation: [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks), [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [Firefox background contexts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), and [Firefox optional host permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_host_permissions). Real-browser acceptance is still required.
