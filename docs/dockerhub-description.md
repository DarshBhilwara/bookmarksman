# bookmarksman

Self-hosted bookmark synchronization for Chrome and Firefox. One lightweight Python/FastAPI backend stores multiple named bookmark collections as JSON files. No database, accounts, analytics, or third-party synchronization service.

## Quick start

```sh
docker run -d --name bookmarksman \
  -p 8080:8080 \
  -v bookmarksman-data:/data \
  --restart unless-stopped \
  darshbhilwara/bookmarksman:1.0.0

curl http://localhost:8080/api/health
```

The image serves HTTP on container port **8080**, runs as a non-root user, and includes a health check. Mount **`/data`** persistently; bookmark collections are stored in `/data/profiles/*.json`. Change the host-side port to use another external port. Bind to your host's VPN interface address when restricting access to your mesh network.

## Browser extensions

Get the extensions from [the bookmarksman repository](https://github.com/DarshBhilwara/bookmarksman). Run `python tools/build-extension.py` there, then follow [the installation instructions](https://github.com/DarshBhilwara/bookmarksman/blob/main/RUNNING.md).

In the popup, connect to your server, enter a profile name, and click **Use profile**. A missing profile is automatically seeded with the browser's current bookmarks. An existing profile asks before replacing local bookmarks. Each browser profile remembers its own server and selection.

Changes upload after a short debounce; other browsers check every five minutes or when you choose Sync now. Nested folders, empty folders, names, and sibling order are preserved. Conflicts retain a recoverable local copy and apply the latest committed server snapshot. Favicons are not synchronized.

## Deployment and backups

The API is unauthenticated. Anyone with network access can read and change bookmark collections; use only on a trusted private LAN or VPN. Do not expose it directly to the public internet.

Back up `/data` or its Docker volume. Removing a container does not remove a named volume, but deleting the volume erases saved profiles.

- [Source and documentation](https://github.com/DarshBhilwara/bookmarksman)
- [Image-based Docker Compose deployment](https://github.com/DarshBhilwara/bookmarksman/blob/main/docker-compose.dockerhub.yml)
- [Publishing and upgrade guide](https://github.com/DarshBhilwara/bookmarksman/blob/main/docs/DOCKERHUB.md)
