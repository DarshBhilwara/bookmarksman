# bookmarksman

Synchronize bookmark collections between Chrome and Firefox using a server you control. The lightweight Python service stores each named collection as a JSON file. No database, account, cloud service, or telemetry is used.

## Run

```sh
docker run -d --name bookmarksman \
  -p 1024:8080 \
  -v bookmarksman-data:/data \
  --restart unless-stopped \
  darshbhilwara/bookmarksman:1.0.0

curl http://localhost:1024/api/health
```

The health endpoint returns `{"status":"ok"}`. Keep the data volume mounted at `/data`; collections are stored under `/data/profiles`. To restrict access, bind host port 1024 to your private LAN or VPN address. The container listens internally on port 8080.

The API has no authentication. Anyone with network access can read or change every collection. Run bookmarksman only on a trusted private network. Do not expose it to the public internet.

## Install the browser extension

The Chrome and Firefox extension is maintained in the [bookmarksman source repository](https://github.com/DarshBhilwara/bookmarksman), not in this image. Build and load it using the [installation guide](https://github.com/DarshBhilwara/bookmarksman/blob/main/RUNNING.md).

In the extension popup, connect to the server, enter a collection name, and choose **Use profile**. A new name is initialized with the current browser's bookmarks. An existing collection asks before replacing local bookmarks. Browser profiles remember their server and last synced collection.

Bookmark changes upload after a short delay; browsers check the server about every five minutes. Names, URLs, folders, nested hierarchy, empty folders, and sibling order are synchronized. When updates conflict, the latest committed server version is applied after saving a recoverable local snapshot. Favicons remain browser-managed.

## Documentation

- [Install and use bookmarksman](https://github.com/DarshBhilwara/bookmarksman/blob/main/RUNNING.md)
- [Docker Compose example](https://github.com/DarshBhilwara/bookmarksman/blob/main/docker-compose.dockerhub.yml)
- [API reference](https://github.com/DarshBhilwara/bookmarksman/blob/main/docs/api.md)
- [Source code](https://github.com/DarshBhilwara/bookmarksman)
