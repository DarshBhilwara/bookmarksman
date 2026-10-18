from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx
import pytest

from app import main
from app.models import BookmarkTree
from app.storage import InvalidProfileName, ProfileStorage, RevisionConflict, StorageError


class SyncASGIClient:
    """Keep tests synchronous without TestClient's AnyIO thread portal."""

    def request(self, method, url, **kwargs):
        async def make_request():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                return await client.request(method, url, **kwargs)
        return asyncio.run(make_request())

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "storage", ProfileStorage(tmp_path / "profiles"))
    return SyncASGIClient()


def tree(title="Docs"):
    return {"roots": {"toolbar": [{"type": "folder", "title": title, "children": [
        {"type": "bookmark", "title": "FastAPI", "url": "https://fastapi.tiangolo.com"},
        {"type": "folder", "title": "Empty", "children": []},
        {"type": "separator"},
    ]}], "menu": [], "other": [], "mobile": []}}


def test_health_and_empty_list(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/profiles").json() == {"profiles": []}


def test_create_get_duplicate_and_list(client):
    created = client.post("/api/profiles/research", json={"tree": tree()})
    assert created.status_code == 201
    profile = created.json()
    assert profile["schema_version"] == 1
    assert profile["tree"] == tree()
    assert client.get("/api/profiles/research").json() == profile
    listing = client.get("/api/profiles").json()["profiles"]
    assert listing == [{"name": "research", "updated_at": profile["updated_at"], "bookmark_count": 1}]
    assert client.post("/api/profiles/research", json={"tree": tree()}).status_code == 409


def test_update_revision_conflict_and_monotonic_timestamp(client):
    first = client.post("/api/profiles/personal", json={"tree": tree()}).json()
    second_response = client.put("/api/profiles/personal", json={"base_updated_at": first["updated_at"], "tree": tree("Renamed")})
    assert second_response.status_code == 200
    second = second_response.json()
    assert second["updated_at"] > first["updated_at"]
    third = client.put("/api/profiles/personal", json={"base_updated_at": second["updated_at"], "tree": tree("Again")}).json()
    assert third["updated_at"] > second["updated_at"]
    stale = client.put("/api/profiles/personal", json={"base_updated_at": first["updated_at"], "tree": tree("Stale")})
    assert stale.status_code == 409
    assert stale.json()["current"]["updated_at"] == third["updated_at"]


@pytest.mark.parametrize("name", ["../secret", "a/b", "a" * 65, "with space", "bang!"])
def test_invalid_names_are_rejected(client, name):
    assert client.get(f"/api/profiles/{name}").status_code in (404, 422)
    assert client.post(f"/api/profiles/{name}", json={"tree": tree()}).status_code in (404, 422)


@pytest.mark.parametrize("name", ["", ".", "..", "../outside", "a/b"])
def test_storage_name_validation_rejects_path_components(tmp_path, name):
    store = ProfileStorage(tmp_path / "profiles")
    with pytest.raises(InvalidProfileName):
        store.get(name)


def test_rejects_malformed_or_unbounded_tree(client):
    malformed = {"roots": {"toolbar": [{"type": "bookmark", "title": "no url"}], "menu": [], "other": [], "mobile": []}}
    assert client.post("/api/profiles/bad", json={"tree": malformed}).status_code == 422
    missing_root = {"roots": {"toolbar": [], "menu": [], "other": []}}
    assert client.post("/api/profiles/bad", json={"tree": missing_root}).status_code == 422
    deep = {"type": "bookmark", "title": "x", "url": "https://example.com"}
    for i in range(66):
        deep = {"type": "folder", "title": str(i), "children": [deep]}
    overdeep = {"roots": {"toolbar": [deep], "menu": [], "other": [], "mobile": []}}
    assert client.post("/api/profiles/deep", json={"tree": overdeep}).status_code == 422


def test_invalid_url_and_revision_body_return_json_validation_errors(client):
    invalid_url = {"roots": {"toolbar": [{"type": "bookmark", "title": "bad", "url": "1bad:thing"}], "menu": [], "other": [], "mobile": []}}
    response = client.post("/api/profiles/url", json={"tree": invalid_url})
    assert response.status_code == 422
    assert "detail" in response.json()
    created = client.post("/api/profiles/revision", json={"tree": tree()}).json()
    response = client.put("/api/profiles/revision", json={"base_updated_at": True, "tree": tree()})
    assert response.status_code == 422
    assert client.get("/api/profiles/revision").json()["updated_at"] == created["updated_at"]


def test_request_limit(client):
    response = client.post("/api/profiles/big", content=b" " * (5 * 1024 * 1024 + 1), headers={"content-type": "application/json"})
    assert response.status_code == 413


def test_persistence_and_failed_atomic_write_keeps_previous(tmp_path, monkeypatch):
    directory = tmp_path / "profiles"
    store = ProfileStorage(directory)
    old = store.create("persist", BookmarkTree.model_validate(tree()))
    path = directory / "persist.json"

    def fail_replace(*_args):
        raise OSError("simulated disk failure")

    monkeypatch.setattr("app.storage.os.replace", fail_replace)
    with pytest.raises(StorageError):
        store.update("persist", old.updated_at, BookmarkTree.model_validate(tree("new")))
    assert json.loads(path.read_text()) == old.model_dump(mode="json")
    monkeypatch.undo()
    assert ProfileStorage(directory).get("persist") == old


def test_failed_temp_file_creation_preserves_previous_profile(tmp_path, monkeypatch):
    store = ProfileStorage(tmp_path / "profiles")
    old = store.create("persist", BookmarkTree.model_validate(tree()))
    path = store.directory / "persist.json"
    old_bytes = path.read_bytes()

    def fail_mkstemp(*_args, **_kwargs):
        raise OSError("simulated full disk")

    monkeypatch.setattr("app.storage.tempfile.mkstemp", fail_mkstemp)
    with pytest.raises(StorageError):
        store.update("persist", old.updated_at, BookmarkTree.model_validate(tree("new")))
    assert path.read_bytes() == old_bytes


def test_timestamp_advances_when_clock_is_frozen(tmp_path, monkeypatch):
    store = ProfileStorage(tmp_path / "profiles")
    monkeypatch.setattr("app.storage.time.time_ns", lambda: 1_000_000_000)
    first = store.create("clock", BookmarkTree.model_validate(tree()))
    second = store.update("clock", first.updated_at, BookmarkTree.model_validate(tree("new")))
    assert (first.updated_at, second.updated_at) == (1000, 1001)


def test_independent_stores_allow_only_one_concurrent_revision_winner(tmp_path):
    directory = tmp_path / "profiles"
    first_store, second_store = ProfileStorage(directory), ProfileStorage(directory)
    initial = first_store.create("race", BookmarkTree.model_validate(tree()))
    barrier = Barrier(2)

    def update(store, title):
        barrier.wait()
        try:
            return store.update("race", initial.updated_at, BookmarkTree.model_validate(tree(title)))
        except RevisionConflict as conflict:
            return conflict

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda args: update(*args), [(first_store, "one"), (second_store, "two")]))
    assert sum(not isinstance(result, RevisionConflict) for result in results) == 1
    assert sum(isinstance(result, RevisionConflict) for result in results) == 1
    current = first_store.get("race")
    assert current.updated_at > initial.updated_at
    assert current.tree.roots.toolbar[0].title in {"one", "two"}


def test_rename_is_revision_checked_and_moves_profile(client):
    profile = client.post("/api/profiles/old", json={"tree": tree()}).json()
    renamed = client.post("/api/profiles/old/rename", json={"name": "new", "base_updated_at": profile["updated_at"]})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "new"
    assert client.get("/api/profiles/old").status_code == 404
    assert client.get("/api/profiles/new").status_code == 200


def test_corrupt_file_is_reported_not_silently_omitted(client, tmp_path, monkeypatch):
    (tmp_path / "profiles" / "broken.json").write_text("not json")
    response = client.get("/api/profiles")
    assert response.status_code == 500
    assert "invalid JSON" in response.json()["detail"]


def test_invalid_utf8_profile_file_is_reported(client, tmp_path):
    (tmp_path / "profiles" / "broken.json").write_bytes(b"\xff\xfe")
    response = client.get("/api/profiles/broken")
    assert response.status_code == 500
    assert "invalid JSON" in response.json()["detail"]
