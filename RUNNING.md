# Running bookmarksman

## 1. Start the server

Install Docker with Compose and Python 3, then open a terminal in the repository:

```sh
cd ~/bookmarksman
```

For a first installation, copy the example settings. Skip this command if you already have a configured `.env`:

```sh
cp .env.example .env
```

Edit `.env` to choose the host address and published port. For your current VPN setup:

```dotenv
BOOKMARKSMAN_BIND=<your tailscale ip>
BOOKMARKSMAN_PORT=1024
```

Use your own VPN address on another machine. The supplied `.env.example` publishes on all host interfaces at port 1024; without `BOOKMARKSMAN_PORT`, Compose falls back to 8080. The API is unauthenticated, so keep access within your trusted LAN or VPN.

Start the server:

```sh
  docker compose up -d --build
  docker compose ps
```

Check it using the address and port from `.env`:

```sh
curl http://<your tailscale ip>/api/health
curl http://<your tailscale ip>/api/profiles
```

Expected health response:

```json
{"status":"ok"}
```

An unused server returns `{"profiles":[]}` from the second command. Existing installations return their saved profiles.

If you use the supplied `.env.example` without edits, check `http://localhost:1024/api/health` on the server machine. Without an `.env` file, the Compose fallback is `http://localhost:8080/api/health`.

## 2. Build and load the extension

From the repository directory:

```sh
python tools/build-extension.py
```

The generated directories and ZIP files are under `dist/`.

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's `dist/bookmarksman-chrome` directory.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist/bookmarksman-firefox/manifest.json` in the repository.

Temporary Firefox add-ons are removed when Firefox closes. See the [README installation notes](README.md#install-the-extension) for lasting installation options. Use disposable browser profiles for your first checks, or export existing bookmarks before replacing them. Disable native Chrome/Firefox bookmark sync while using bookmarksman.

## 3. Connect, then choose a profile

1. Open the bookmarksman extension popup.
2. Enter your server URL, for example `http://100.120.83.124:1024`.
3. Click **Connect** and grant access to the server when prompted.
4. After connection succeeds, the **Profile name** field appears. Enter a name such as `research`, or choose an existing suggestion.
5. Click **Use profile**.

If the name does not exist, bookmarksman automatically saves this browser's current bookmarks to that new server profile. There is no separate creation or import step.

If the name already exists, bookmarksman asks before replacing local bookmarks with the server tree and saves a local recovery snapshot first.

Automatic synchronization starts after successful setup. Each installed browser profile saves the server URL and last successfully synced profile. Reopening the popup fills these in before connecting, and shows the last synced pair while offline; profile actions remain unavailable until connection succeeds. A failed connection or restore keeps the last successful profile name. These settings survive ordinary extension reloads and browser restarts while the add-on remains installed. Firefox temporary add-ons are removed when Firefox closes, so use a signed/permanent installation if you want the add-on itself to remain installed after restart; uninstalling the add-on or clearing its storage can erase local settings.

To rename the current server profile, enter its new name in the same field and click **Rename current profile**. Other browsers using the old name must select the new name. Clicking **Use profile** instead selects that name for synchronization.

## 4. Check Chrome–Firefox synchronization

1. In the first browser, add a test bookmark inside a folder. Include a nested folder and an empty folder if you want to check hierarchy preservation.
2. Wait about seven seconds for the upload while the browser is awake.
3. In the other browser, connect to the same server and use the same profile name. Confirm replacement if this is the first binding.
4. Verify bookmark names, hierarchy, and ordering.
5. Rename, reorder, or delete a test bookmark in either browser. Wait for upload, then click **Sync now** in the other browser, or wait for its five-minute polling check.

Different server profile names synchronize independently. For a complete acceptance procedure, see [the browser checklist](docs/browser-checks.md). The [verification record](docs/verification.md) distinguishes automated checks from real-browser testing.

## 5. Apply extension updates

After updating the repository files, rebuild the extension packages:

```sh
python tools/build-extension.py
```

Reload the existing extension:

- Chrome: `chrome://extensions` → bookmarksman → reload icon.
- Firefox: `about:debugging#/runtime/this-firefox` → bookmarksman → **Reload**.

Reload instead of uninstalling so local settings and recovery snapshots remain available. Extension-only updates do not require rebuilding Docker. For backend updates, run `docker compose up -d --build` again.

## Logs, stopping, and troubleshooting

Follow server logs (press Ctrl+C to stop following):

```sh
docker compose logs -f bookmarksman
```

Stop the server:

```sh
docker compose down
```

The named Docker volume retains your profiles. Avoid `docker compose down -v`, which deletes the data volume. See [backup and restore commands](README.md#backups).

- **Cannot connect to localhost:** if Docker is bound to `100.120.83.124`, use that VPN address instead of `localhost`. A browser on another machine must use the server's reachable address.
- **`{"detail":"Not Found"}` at `/`:** expected; there is no server website. Test `/api/health` and put only the base URL in the extension.
- **Changed `.env` settings:** run `docker compose up -d` to recreate the container with the new published address/port. A simple restart does not change its port mapping.
- **Old popup or timer error after updating:** rebuild the extension, then reload the existing add-on from its browser extension-management page.
- **Profile controls do not appear:** check the URL, VPN connectivity, server health, and extension server-access permission; click **Connect** again.
- **Restore failed:** use the popup's **Recovery snapshots** section to export or restore a saved local copy. Automatic synchronization pauses after a failed restore.

For a Firefox `NetworkError`, first open the exact `/api/health` URL in that same Firefox profile. If it loads, inspect bookmarksman through `about:debugging#/runtime/this-firefox` → **Inspect**, retry **Connect**, and copy the console error. Also check its server-access permission in `about:addons`. If the health URL itself fails, check the server address, published port, VPN reachability, and Firefox proxy settings. The extension now reports missing host permissions separately and includes the failing endpoint in network errors.

### Firefox upgrades HTTP to HTTPS

A console message such as `Content-Security-Policy: Upgrading insecure request` followed by a failed HTTPS request means Firefox's default Manifest V3 policy upgraded the configured HTTP URL. The Firefox manifest now explicitly permits HTTP/HTTPS connections without `upgrade-insecure-requests`, while restricting scripts to packaged files. Rebuild with `python tools/build-extension.py`, reload the existing Firefox add-on, then reconnect using your original `http://` URL. No Docker change or server CORS workaround is needed for this policy issue.

Reference: [Mozilla's Manifest V3 insecure-request policy](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy).

## Run a published Docker Hub image

For publishing commands and a pull-based installation using `docker-compose.dockerhub.yml`, see [the Docker Hub guide](docs/DOCKERHUB.md). Extensions continue to be built and installed from this repository; they are not included in the server image.
