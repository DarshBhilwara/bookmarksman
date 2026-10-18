# bookmarksman

Keep bookmark collections on a server you control and synchronize them between Chrome and Firefox. Choose a named collection for each browser profile, or use the same collection across several browsers.

bookmarksman preserves bookmark names, URLs, nested folders, empty folders, and sibling order. Changes upload automatically after a short delay, and other browsers check for updates every five minutes. There are no accounts, database, cloud service, or telemetry.

The backend runs in Docker and stores collections as JSON files. Browser extensions are installed from this repository and remember their server address and last synced collection.

## Get started

You need Docker with Compose on your server and Python 3 to prepare the browser extensions.

1. [Start the server](RUNNING.md#start-the-server) using the Docker Hub image `darshbhilwara/bookmarksman:1.0.0` or build from source.
2. [Build and install a private extension](docs/private-addons.md) in Chrome or Firefox. No public store listing is required.
3. [Connect and choose a collection](RUNNING.md#connect-and-select-a-collection). A new name saves the browser's current bookmarks; an existing name asks before replacing local bookmarks.

**Use a trusted LAN or VPN.** The API has no authentication, so anyone who can reach it can read or change every collection. Do not expose it directly to the public internet.

## Manage your bookmarks

Each browser profile keeps its own configuration. You can switch or rename collections from the popup, sync immediately, and recover saved local snapshots if a replacement fails or changes conflict. See [synchronization and recovery](RUNNING.md#synchronization-and-recovery).

Server collections live in `/data/profiles` on a persistent Docker volume. Removing a container retains the volume; deleting the volume erases the collections. Follow [the backup instructions](RUNNING.md#back-up-and-restore) to keep an independent copy.

Chrome and Firefox have different bookmark roots. Unsupported categories use reserved wrapper folders; see [browser differences](RUNNING.md#browser-differences). Favicons are managed by each browser and are not synchronized.

## Documentation

- [Install, configure, update, and troubleshoot](RUNNING.md)
- [Test your installation](docs/browser-checks.md)
- [Server API reference](docs/api.md)
- [Run automated checks](docs/verification.md)
- [Build and publish a Docker image](docs/DOCKERHUB.md)
