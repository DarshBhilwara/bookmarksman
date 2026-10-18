from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .models import CreateProfile, Profile, RenameProfile, UpdateProfile
from .storage import (
    CorruptProfile,
    InvalidProfileName,
    ProfileExists,
    ProfileNotFound,
    ProfileStorage,
    RevisionConflict,
    StorageError,
)

MAX_REQUEST_BYTES = 5 * 1024 * 1024
storage: ProfileStorage | None = None
app = FastAPI(title="bookmarksman", version="1.0.0")


def get_storage() -> ProfileStorage:
    global storage
    if storage is None:
        storage = ProfileStorage(os.environ.get("BOOKMARKSMAN_DATA", "/data/profiles"))
    return storage


class RequestSizeLimitMiddleware:
    """Buffer request bodies up to the API cap, then replay to FastAPI."""

    def __init__(self, app, limit: int):
        self.app = app
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > self.limit:
                    await self._too_large(scope, send)
                    return
            except ValueError:
                response = JSONResponse({"detail": "invalid Content-Length"}, status_code=400)
                await response(scope, receive, send)
                return
        chunks: list[bytes] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > self.limit:
                await self._too_large(scope, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        sent = False

        async def replay_receive():
            nonlocal body, sent
            if sent:
                return await receive()
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_receive, send)

    @staticmethod
    async def _too_large(scope, send):
        response = JSONResponse({"detail": "request body exceeds 5 MiB"}, status_code=413)
        await response(scope, lambda: None, send)


app.add_middleware(RequestSizeLimitMiddleware, limit=MAX_REQUEST_BYTES)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse({"detail": jsonable_encoder(exc.errors(), custom_encoder={ValueError: str, TypeError: str})}, status_code=422)


@app.exception_handler(InvalidProfileName)
async def invalid_name_handler(_request: Request, exc: InvalidProfileName):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(ProfileNotFound)
async def not_found_handler(_request: Request, exc: ProfileNotFound):
    return JSONResponse({"detail": f"profile '{exc}' does not exist"}, status_code=404)


@app.exception_handler(ProfileExists)
async def exists_handler(_request: Request, exc: ProfileExists):
    return JSONResponse({"detail": f"profile '{exc}' already exists"}, status_code=409)


@app.exception_handler(RevisionConflict)
async def conflict_handler(_request: Request, exc: RevisionConflict):
    return JSONResponse({"detail": "profile changed since the supplied revision", "current": exc.current.model_dump(mode="json")}, status_code=409)


@app.exception_handler(CorruptProfile)
async def corrupt_handler(_request: Request, exc: CorruptProfile):
    return JSONResponse({"detail": str(exc)}, status_code=500)


@app.exception_handler(StorageError)
async def storage_error_handler(_request: Request, exc: StorageError):
    return JSONResponse({"detail": str(exc)}, status_code=500)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/profiles")
async def list_profiles():
    profiles = get_storage().list_profiles()
    return {"profiles": [item.model_dump(mode="json") for item in profiles]}


@app.get("/api/profiles/{name}", response_model=Profile)
async def get_profile(name: str):
    return get_storage().get(name)


@app.post("/api/profiles/{name}", response_model=Profile, status_code=201)
async def create_profile(name: str, payload: CreateProfile):
    return get_storage().create(name, payload.tree)


@app.put("/api/profiles/{name}", response_model=Profile)
async def update_profile(name: str, payload: UpdateProfile):
    return get_storage().update(name, payload.base_updated_at, payload.tree)


@app.post("/api/profiles/{name}/rename", response_model=Profile)
async def rename_profile(name: str, payload: RenameProfile):
    return get_storage().rename(name, payload.name, payload.base_updated_at)
