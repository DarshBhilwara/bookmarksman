# Publish the bookmarksman backend to Docker Hub

Only the backend is published as a container. The Chrome/Firefox extension sources stay in `extension/` in this repository. Run `python tools/build-extension.py` to generate their loadable directories and ZIPs in `dist/`; generated packages are ignored by Git. There are no extension-store publishing steps.

The Docker Hub repository is **`darshbhilwara/bookmarksman`**. The commands below use that namespace and repository.

## Build and check locally

Requires Python 3, Docker with Buildx, and access to the running Docker daemon. Run from the repository root:

```sh
# Review the command without requiring a Docker daemon.
python tools/publish-docker.py darshbhilwara 1.0.0 --dry-run

# Build and load an image for this machine; nothing is published.
python tools/publish-docker.py darshbhilwara 1.0.0
```

The build context is restricted to `server/`. Bookmarks, browser settings, repository credentials, and extension packages are not copied into the image. The image runs as a non-root user, stores profiles at `/data/profiles`, and includes a health check and OCI title/source/version metadata.

Run a separate test container and volume so the release check does not modify your current bookmarksman deployment. Change host port 18080 if it is already occupied:

```sh
docker run -d --name bookmarksman-check \
  -p 127.0.0.1:18080:8080 \
  -v bookmarksman-check-data:/data \
  darshbhilwara/bookmarksman:1.0.0
curl --fail http://127.0.0.1:18080/api/health
docker inspect --format '{{.State.Health.Status}}' bookmarksman-check
docker logs bookmarksman-check
```

The health endpoint should return `{"status":"ok"}`. The container's health status may initially be `starting`; wait for its health check to run. Test the extension against `http://127.0.0.1:18080` from the same machine using a disposable browser/profile if desired. To stop and remove just this test container:

```sh
docker rm -f bookmarksman-check
```

Its named test volume remains until you explicitly remove it. Keep your existing production volume intact.

## Publish

1. Create a public repository named `bookmarksman` under the Docker Hub account `darshbhilwara`.
2. Log in interactively. Use your password or a suitable Docker Hub personal access token when Docker prompts; do not put credentials in scripts, Git, or `.env` files.
3. Publish the tested version:

```sh
docker login --username darshbhilwara
python tools/publish-docker.py darshbhilwara 1.0.0 --push
```

`--push` explicitly builds and publishes. Without it, the script only loads an image locally. To also move the `latest` alias, opt in with:

```sh
python tools/publish-docker.py darshbhilwara 1.0.0 --push --latest
```

Use a fresh version tag for each release. Docker tags can be overwritten unless you configure registry tag immutability; the script does not enforce immutability. Preview any release command with `--dry-run`.

Check Docker Hub's **Tags** page, and inspect the published image:

```sh
docker buildx imagetools inspect darshbhilwara/bookmarksman:1.0.0
```

Copy [the prepared Docker Hub description](dockerhub-description.md) into the repository overview. It links users to this repository for extensions and setup instructions.

## Optional AMD64 and ARM64 release

The default build targets the host architecture. To publish for 64-bit Intel/AMD and ARM hosts:

```sh
docker buildx create --name bookmarksman-builder --driver docker-container --use
docker buildx inspect --bootstrap
python tools/publish-docker.py darshbhilwara 1.0.0 \
  --platforms linux/amd64,linux/arm64 --push
```

Create the builder only once; select an existing one later with `docker buildx use bookmarksman-builder`. Building for another CPU architecture requires native build nodes or working emulation. Docker Desktop includes emulation; other hosts may need QEMU/binfmt configured. See [Docker's multi-platform guide](https://docs.docker.com/build/building/multi-platform/).

The script requires `--push` for multiple platforms. A single explicit platform, such as `--platforms linux/amd64`, can be loaded locally without publishing.

## Run the published image

For a new deployment, copy the image-based environment example without replacing your existing `.env`:

```sh
cp .env.dockerhub.example .env.dockerhub
```

Edit `.env.dockerhub`:

```dotenv
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0
BOOKMARKSMAN_BIND=0.0.0.0
BOOKMARKSMAN_PORT=8080
```

Set the bind address to your VPN interface IP if you want access only through that interface. Then:

```sh
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml pull
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml up -d
docker compose --env-file .env.dockerhub -f docker-compose.dockerhub.yml logs -f
```

Use `docker-compose.dockerhub.yml` by itself; do not merge it with the source-build Compose file. The image name is required and Compose reports a clear error if it is empty. To stop, use the same flags with `down`; omit `-v` to retain the data.

### Switch an existing checkout from local builds

Back up first using [the existing backup instructions](../README.md#backups). Keep the same repository directory and Compose project name (including any custom `-p` option). Both Compose files use the same service and volume keys, so the existing named volume is reused. Keep your existing `.env` for its current VPN bind address and port, and supply only the image:

```sh
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0 \
  docker compose -f docker-compose.dockerhub.yml pull
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0 \
  docker compose -f docker-compose.dockerhub.yml up -d
```

The container is recreated with the published image; stored JSON remains in the same volume. Do not run the old build-based `up` command afterward unless you want to switch back. For upgrades, change the version and run the same `pull` and `up -d` commands.

## Checks

```sh
python -m unittest discover -s tools/tests -p 'test_*.py'
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0 docker compose -f docker-compose.dockerhub.yml config --quiet
```

The release script tests use mocked Docker commands, not a live daemon. Check [the verification record](verification.md) for what was actually run. Publishing requires your own Docker Hub account and credentials.

References: [Docker image publishing](https://docs.docker.com/docker-hub/repos/manage/hub-images/push/) and [Buildx command reference](https://docs.docker.com/reference/cli/docker/buildx/build/).
