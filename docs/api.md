# Server API

The bookmarksman API is intended for the browser extension and basic health checks. All routes use the `/api` prefix. The API has no authentication; keep it reachable only on a trusted network.

## Health

`GET /api/health` returns `{"status":"ok"}` when the service is running.

## List collections

`GET /api/profiles` returns collection names, their current server revision in Unix milliseconds, and bookmark count:

```json
{
  "profiles": [
    {"name": "research", "updated_at": 1792345678901, "bookmark_count": 12}
  ]
}
```

## Read a collection

`GET /api/profiles/{name}` returns the full record:

```json
{
  "schema_version": 1,
  "name": "research",
  "updated_at": 1792345678901,
  "tree": {
    "roots": {
      "toolbar": [],
      "menu": [],
      "other": [],
      "mobile": []
    }
  }
}
```

Each root is an ordered array of nodes. A bookmark is `{"type":"bookmark","title":"Example","url":"https://example.com"}`. A folder is `{"type":"folder","title":"Reading","children":[]}`; child order is array order and an empty array represents an empty folder. Separators use `{"type":"separator"}`. Browser bookmark IDs and parent IDs are not stored.

The four roots are portable categories rather than browser root IDs. The extension maps each browser's roots and uses reserved wrapper folders for unsupported categories; details are in [the running guide](../RUNNING.md#synchronization-and-recovery).

## Create a collection

`POST /api/profiles/{name}` creates a collection:

```json
{"tree":{"roots":{"toolbar":[],"menu":[],"other":[],"mobile":[]}}}
```

The server sets `updated_at`. An existing name returns HTTP 409.

## Update a collection

`PUT /api/profiles/{name}` updates the full tree only if the supplied base revision is still current:

```json
{
  "base_updated_at": 1792345678901,
  "tree": {"roots":{"toolbar":[],"menu":[],"other":[],"mobile":[]}}
}
```

On success, the server returns the updated record with a new server-generated revision. Revisions increase monotonically, including for rapid updates. A stale base returns HTTP 409. Clients must fetch the latest record and apply the documented conflict policy; they cannot choose the authoritative revision.

## Rename a collection

`POST /api/profiles/{name}/rename` renames a collection:

```json
{"name":"reading","base_updated_at":1792345678901}
```

The rename requires the current revision. The new name must be valid and unused.

## Names, errors, and storage

Names contain 1–64 ASCII letters, digits, underscores, or hyphens. Invalid names and malformed trees return a client error. Missing collections return HTTP 404. Duplicate names and stale revisions return HTTP 409. Requests are size and tree-complexity limited.

Each collection is stored as a JSON file below `/data/profiles`. Writes are serialized and use atomic replacement so an interrupted write does not leave a partially written record. Preserve the persistent `/data` volume when replacing or upgrading the container.
