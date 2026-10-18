# Docker Hub image: publishing and installation

This guide is for maintainers building or publishing the backend image. Users installing bookmarksman can follow [the running guide](../RUNNING.md). The browser extensions stay in the repository and are installed separately; they are not included in the image.

The image repository is `darshbhilwara/bookmarksman`. Publish a version tag before recommending that version to users.

## Build and check a release

Run commands from the repository root. Docker with Buildx and access to the Docker daemon are required to build an image.

Preview the build command, then build an image for the current machine without publishing it:

```sh
python tools/publish-docker.py darshbhilwara 1.0.0 --dry-run
python tools/publish-docker.py darshbhilwara 1.0.0
```

Test the image using a separate container and volume so it does not access existing bookmark data:

```sh
docker run -d --name bookmarksman-check \
  -p 127.0.0.1:18080:8080 \
  -v bookmarksman-check-data:/data \
  darshbhilwara/bookmarksman:1.0.0
curl --fail http://127.0.0.1:18080/api/health
docker inspect --format '{{.State.Health.Status}}' bookmarksman-check
docker logs bookmarksman-check
docker rm -f bookmarksman-check
```

The health response should be `{"status":"ok"}`. The test volume remains after removing the container and can be reused or explicitly removed when no longer needed. Do not point a release test at a user's production volume.

## Publish a version

Create a public `bookmarksman` repository under the Docker Hub account `darshbhilwara`. Log in interactively, then build and publish a version:

```sh
docker login --username darshbhilwara
python tools/publish-docker.py darshbhilwara 1.0.0 --push
```

Use a new version for each release. To also update the `latest` alias, pass `--latest`:

```sh
python tools/publish-docker.py darshbhilwara 1.0.0 --push --latest
```

Check the published tag and image metadata:

```sh
docker buildx imagetools inspect darshbhilwara/bookmarksman:1.0.0
```

Copy [the prepared repository description](dockerhub-description.md) into the Docker Hub repository overview. It points users to the source repository for extension downloads and setup instructions.

For a multi-platform AMD64 and ARM64 image, create a Buildx builder once, then publish both platforms:

```sh
docker buildx create --name bookmarksman-builder --driver docker-container --use
docker buildx inspect --bootstrap
python tools/publish-docker.py darshbhilwara 1.0.0 \
  --platforms linux/amd64,linux/arm64 --push
```

See [Docker's multi-platform guide](https://docs.docker.com/build/building/multi-platform/) for builder and emulation requirements.

## Compose deployment for the published image

The user-facing example is [docker-compose.dockerhub.yml](../docker-compose.dockerhub.yml). Use it from a repository checkout with `.env.dockerhub.example` copied to `.env.dockerhub`, as described in the running guide. The Compose service exposes container port 8080, stores data in a named volume, and restarts unless stopped. Keep the volume name stable when upgrading.

To switch an existing checkout from source builds to the published image, back up the data first. Keep the same checkout directory and Compose project name so Compose finds the existing volume. Use the image compose file with the existing `.env` values for address and port:

```sh
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0 \
  docker compose -f docker-compose.dockerhub.yml pull
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0 \
  docker compose -f docker-compose.dockerhub.yml up -d
```

For repeat use, copy `.env.dockerhub.example` to a private env file and pass it with `--env-file`. Do not commit secrets into deployment files. For normal start, backup, restore, and troubleshooting steps, see [Running bookmarksman](../RUNNING.md).

## Checks

The publishing helper's unit tests and Compose configuration can be checked with:

```sh
python -m unittest discover -s tools/tests -p 'test_*.py'
BOOKMARKSMAN_IMAGE=darshbhilwara/bookmarksman:1.0.0 \
  docker compose -f docker-compose.dockerhub.yml config --quiet
```

The helper tests mock Docker commands. They do not replace building, starting, and checking the published image. See [the verification guide](verification.md) for automated checks and the browser checklist.
