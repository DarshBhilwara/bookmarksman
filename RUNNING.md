# Install and use bookmarksman

You need Docker with Compose on the server and Python 3 to prepare the extension on the computer running Chrome or Firefox. The server and browser can run on different computers connected by a trusted LAN or VPN.

## Start the server

Clone or copy this repository onto the server. For a new checkout:

```sh
git clone https://github.com/DarshBhilwara/bookmarksman.git
cd bookmarksman
```

Choose one of the following deployment methods. Keep using the same checkout directory and Compose project name so Docker reuses your data volume.

### Use a Docker Hub image

The image name is `darshbhilwara/bookmarksman:1.0.0`. Copy the image configuration for a first installation; keep an existing configuration when updating:

```sh
cp .env.dockerhub.example .env.dockerhub
```

Edit `.env.dockerhub` to choose the image, network interface, and host port:

```dotenv
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0
BOOKMARKSMAN_BIND=0.0.0.0
BOOKMARKSMAN_PORT=1024
```

`0.0.0.0` listens on all host interfaces. To accept connections only through your VPN, set `BOOKMARKSMAN_BIND` to the server's VPN interface IP. The API is unauthenticated; keep it on your trusted network.

Start the backend:

```sh
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml pull
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml up -d
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml ps
```

If the selected image tag is unavailable or you prefer to build locally, use the source-build method below. Use the image Compose file by itself, without merging it with `docker-compose.yml`.

### Standalone Compose example

For a new deployment without the repository's Compose files, save this as `compose.yaml` in a dedicated deployment directory. Use this method instead of starting a second server alongside an existing installation:

```yaml
services:
  bookmarksman:
    image: darshbhilwara/bookmarksman:1.0.0
    container_name: bookmarksman
    ports:
      - "0.0.0.0:1024:8080"
    volumes:
      - bookmarksman-data:/data
    restart: unless-stopped

volumes:
  bookmarksman-data:
```

Replace `0.0.0.0` with your VPN interface IP to restrict access. Change only the first `1024` in the port mapping to choose another host port. The image includes its own health check.

### Docker Hub behind Traefik

If Traefik is already connected to an external Docker network named `proxy`, the repository includes [`docker-compose.traefik.yml`](docker-compose.traefik.yml). It routes `bookmarksman.home` to the API, probes `/api/health`, publishes host port `1024` to container port `8080`, and stores profile files in `/data/configs/bookmarksman` on the Docker host. Traefik reaches the container on the `proxy` network.

Make sure `bookmarksman.home` resolves to the Traefik host on your LAN or VPN, then run:

```sh
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
docker compose -f docker-compose.traefik.yml pull
docker compose -f docker-compose.traefik.yml up -d
docker compose -f docker-compose.traefik.yml ps
curl --fail http://bookmarksman.home/api/health
curl --fail http://localhost:1024/api/health
```

The external network must be shared with Traefik. Change the image tag in the Compose file when installing another release. Back up `/data/configs/bookmarksman/profiles` on the host. Use `docker compose -f docker-compose.traefik.yml logs -f bookmarksman` to view logs, and `docker compose -f docker-compose.traefik.yml down` to stop it while retaining the bind-mounted data.

From the directory containing `compose.yaml`:

```sh
docker compose pull
docker compose up -d
docker compose ps
curl --fail http://localhost:1024/api/health
```

Use the configured VPN address instead of `localhost` if you bind to that interface. To update, change the image version in `compose.yaml` and rerun `pull` and `up -d`. View logs with `docker compose logs -f bookmarksman`; stop with `docker compose down` without `-v`. For backups, use the plain `docker compose` commands under [Source-build or standalone Compose deployment](#source-build-or-standalone-compose-deployment).

### Build from source

For a first installation, copy the source-build settings:

```sh
cp .env.example .env
```

The supplied `.env.example` uses host port **1024**. Edit its bind address and port as needed, then run:

```sh
docker compose up -d --build
docker compose ps
```

Without a configured `BOOKMARKSMAN_PORT`, both Compose files fall back to host port 1024. The backend always listens on container port 8080.

### Check the connection

Use your configured host address and port. With an all-interface binding and host port 1024, check locally on the server with:

```sh
curl --fail http://localhost:1024/api/health
```

For a VPN-only binding, use that VPN address instead of `localhost`. For example, if the configured address is `192.168.1.10` and port is 1024:

```sh
curl --fail http://192.168.1.10:1024/api/health
curl --fail http://192.168.1.10:1024/api/profiles
```

Replace the example address with your own server address. If you copied `.env.example` unchanged for a source build, the local health URL is `http://localhost:1024/api/health`.

The health endpoint returns `{"status":"ok"}`. An unused server returns `{"profiles":[]}` from the profile-list endpoint. There is no website at `/`; the extension is the application interface.

## Install the extension

On each computer running a browser, clone or copy this repository. From its directory, run:

```sh
python tools/build-extension.py
```

The build creates a Chrome directory/ZIP and a Firefox unsigned XPI under `dist/`. For private installations that remain after browser restart, follow [the private add-on guide](docs/private-addons.md).

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `dist/bookmarksman-chrome`.

Keep that folder in place. Chrome retains the locally loaded extension across restarts.

### Firefox

For a local unsigned build, use Firefox Developer Edition, Nightly, or ESR with unsigned-add-on support enabled, then install `dist/bookmarksman-firefox-unsigned.xpi` through `about:addons` → gear menu → **Install Add-on From File…**. See [the exact steps and edition requirements](docs/private-addons.md#local-unsigned-package).

Standard release Firefox requires a signed XPI for permanent installation. Mozilla's unlisted signing channel supports private self-distribution without a public store listing. Follow [the signing steps](docs/private-addons.md#standard-firefox-unlisted-signing) if you use that edition.

For a temporary installation in standard Firefox, open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** and select `dist/bookmarksman-firefox/manifest.json`. No signing is required; it remains installed until Firefox closes. Both this directory and the permanent-install XPI are built together.

The extension targets Chrome 120 and Firefox 128 or later. Export important bookmarks using the browser's bookmark manager before the first replacement. Disable native Chrome Sync or Firefox Sync for bookmarks while using bookmarksman so two synchronization systems do not change the same tree.

## Connect and select a collection

1. Open the bookmarksman popup.
2. Enter your server's base URL, including its host port, such as `http://192.168.1.10:1024`. Do not append `/api`.
3. Click **Connect** and allow access to that server when prompted.
4. Enter a name such as `research`, or choose an existing suggestion, then click **Use profile**.

A new name saves this browser's current bookmarks to the server and starts syncing automatically. An existing name displays local/server bookmark counts and asks before replacing local bookmarks. A recovery snapshot is saved first.

On another browser profile, connect to the same server and select the same name. Confirm replacement to receive that collection. Different collection names synchronize independently.

Names use 1–64 ASCII letters, digits, underscores, or hyphens. Each browser profile saves its server address, last successfully synced collection, and automatic-sync setting. The popup shows the saved server and collection even while offline. Uninstalling the extension or clearing its storage can erase these settings and local recovery snapshots.

To switch collections, enter another name and choose **Use profile**. To rename the current server collection, enter its new name and choose **Rename current profile**. Other browsers using the old name must select the new one.

## Synchronization and recovery

Local changes upload after about seven seconds while the browser is awake. The extension checks the server every five minutes and reconciles at browser startup. Choose **Sync now** for an immediate check. Sleeping computers and browser scheduling can delay background work.

If changes conflict, the latest successfully saved server snapshot wins. Pending local changes are saved as a recovery snapshot before the server version is applied. Individual bookmarks are not merged automatically.

If restoration fails or is interrupted, automatic sync pauses to avoid uploading a partial tree. Under **Recovery snapshots**, you can:

- Select a saved snapshot and choose **Export selected snapshot** to download it.
- Choose **Restore most recent local snapshot** to recover locally.
- Use **Import an exported snapshot file** to restore a downloaded copy.

Local recovery pauses synchronization and removes the active binding. To save recovered bookmarks to the server, connect and use a new collection name. Selecting an existing collection replaces them with that server collection after confirmation.

Up to ten snapshots are retained locally; an unresolved restore keeps its original recovery copy. Download important snapshots before uninstalling the extension. Avoid editing bookmarks during replacement. If a native bookmark import is interrupted by a background restart, enable automatic sync again after the browser finishes importing.

## Browser differences

The extension maps toolbar, menu, other, and mobile bookmark categories. If a destination browser lacks a category, its contents appear in a reserved folder under Other bookmarks, such as `[bookmarksman-root:menu]` or `[bookmarksman-root:mobile]`. Chrome represents Firefox separators with an empty folder named `[bookmarksman:separator]`. Leave these marker names unchanged so categories and separators survive round trips.

Managed, unknown, or ambiguous root layouts are refused before replacement. Browser-specific URL restrictions can also prevent restoration; the popup reports the failure and retains a recovery snapshot. Favicons and the names of permanent browser roots remain browser-controlled.

## Back up and restore

Back up server collections independently of the extension's local recovery snapshots. Run the following commands from the same checkout and with the same Compose project name as the running service. They use the service's mounted `/data` volume, including Docker's project prefix.

### Docker Hub deployment

Stop the service briefly and stream a backup into the current directory:

```sh
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml stop
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml run --rm --no-deps -T bookmarksman python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz'); t.add('/data/profiles',arcname='profiles'); t.close()" > bookmarksman-data.tar.gz
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml up -d
```

Restore a trusted backup:

```sh
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml stop
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml run --rm --no-deps -T bookmarksman python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz'); t.extractall('/data',filter='data'); t.close()" < bookmarksman-data.tar.gz
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml up -d
```

### Source-build or standalone Compose deployment

Use the same backup format with the source-build Compose file:

```sh
docker compose stop
docker compose run --rm --no-deps -T bookmarksman python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz'); t.add('/data/profiles',arcname='profiles'); t.close()" > bookmarksman-data.tar.gz
docker compose up -d
```

To restore:

```sh
docker compose stop
docker compose run --rm --no-deps -T bookmarksman python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz'); t.extractall('/data',filter='data'); t.close()" < bookmarksman-data.tar.gz
docker compose up -d
```

Restoring replaces matching files; collections absent from the archive remain in the volume. Use a clean destination volume for an exact full restore. Keep backups private because bookmark URLs can contain sensitive information.

### Standalone Docker run deployment

If you used the Docker Hub page's `docker run` example, back up the existing container's mounted data directly. These commands reuse its image and volume, so they do not depend on a Compose project name:

```sh
docker stop bookmarksman
docker run --rm --volumes-from bookmarksman:ro --entrypoint python "$(docker inspect --format '{{.Image}}' bookmarksman)" -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz'); t.add('/data/profiles',arcname='profiles'); t.close()" > bookmarksman-data.tar.gz
docker start bookmarksman
```

To restore a trusted archive:

```sh
docker stop bookmarksman
docker run --rm -i --volumes-from bookmarksman --entrypoint python "$(docker inspect --format '{{.Image}}' bookmarksman)" -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz'); t.extractall('/data',filter='data'); t.close()" < bookmarksman-data.tar.gz
docker start bookmarksman
```

Keep the stopped container in place while copying; `--volumes-from` needs it to identify the mounted data.

## Update, view logs, and stop

For a Docker Hub deployment, choose the desired image version in `.env.dockerhub`, then run:

```sh
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml pull
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml up -d
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml logs -f bookmarksman
```

Stop it with:

```sh
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml down
```

For a source-build deployment, update the repository and run:

```sh
docker compose up -d --build
docker compose logs -f bookmarksman
```

Stop it with `docker compose down`. For either method, omit `-v` to retain the data volume. Back up before upgrading, and keep the same directory and project name. See [the image guide](docs/DOCKERHUB.md#compose-deployment-for-the-published-image) if switching from source builds to Docker Hub.

To update the extension, get the newer repository version and run `python tools/build-extension.py`. Reload Chrome from its existing folder. For a permanently installed Firefox add-on, install the updated XPI over the existing add-on; standard Firefox requires a newly signed package. Follow [the private update instructions](docs/private-addons.md#updates-and-saved-settings). Extension-only changes do not require a Docker rebuild. Avoid uninstalling, which can erase local settings.

## Troubleshooting

- **Cannot connect to localhost:** use the configured bind address and port. A browser on another computer must use the server's reachable LAN/VPN address; `localhost` refers to the browser's own computer.
- **“Not Found” at `/`:** expected; check `/api/health` and enter only the base URL in the popup.
- **Profile controls are missing:** click **Connect** first. Controls appear after a successful connection.
- **Network error:** open the exact health URL in the same browser. If it fails, check the address, port, VPN, firewall, and browser proxy. If it succeeds, check the extension's server-access permission and console through its browser-management page.
- **HTTP is unexpectedly upgraded to HTTPS in Firefox:** rebuild and reload the current extension. Its Firefox policy supports HTTP servers on private networks.
- **Restore failed:** export the saved recovery snapshot before retrying recovery. Automatic sync stays paused until the operation is resolved.
- **Port or interface changed in the configuration:** rerun the appropriate `up -d` command. Restarting an existing container alone does not change its published port mapping.

See [the browser checklist](docs/browser-checks.md) to test with disposable profiles, [automated checks](docs/verification.md) for contributor tests, and [the API reference](docs/api.md) for integrations.
