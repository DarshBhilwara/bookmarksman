from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import fcntl
from pydantic import ValidationError

from .models import Bookmark, BookmarkTree, Folder, Profile, ProfileSummary

PROFILE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class StorageError(Exception):
    pass


class ProfileNotFound(StorageError):
    pass


class ProfileExists(StorageError):
    pass


class RevisionConflict(StorageError):
    def __init__(self, current: Profile):
        self.current = current
        super().__init__("profile changed since the supplied revision")


class InvalidProfileName(StorageError):
    pass


class CorruptProfile(StorageError):
    pass


class ProfileStorage:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory)
        self._thread_lock = threading.RLock()
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise StorageError(f"could not create profile storage directory: {exc}") from exc
        self.lock_path = self.directory / ".lock"

    @staticmethod
    def validate_name(name: str) -> str:
        if not PROFILE_RE.fullmatch(name):
            raise InvalidProfileName("profile names must be 1-64 letters, digits, underscores, or hyphens")
        return name

    def _path(self, name: str) -> Path:
        return self.directory / f"{self.validate_name(name)}.json"

    @contextmanager
    def _locked(self) -> Iterator[None]:
        # The thread lock complements flock: flock is process-safe, while
        # separate threads in one process may share a file description.
        with self._thread_lock:
            try:
                fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            except OSError as exc:
                raise StorageError(f"could not open profile storage lock: {exc}") from exc
            try:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX)
                except OSError as exc:
                    raise StorageError(f"could not lock profile storage: {exc}") from exc
                yield
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)

    def _read(self, name: str) -> Profile:
        path = self._path(name)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise ProfileNotFound(name) from exc
        except UnicodeDecodeError as exc:
            raise CorruptProfile(f"profile {name} contains invalid JSON or data") from exc
        except OSError as exc:
            raise StorageError(f"could not read profile {name}: {exc}") from exc
        try:
            profile = Profile.model_validate_json(raw)
            if profile.name != name:
                raise ValueError("stored profile name does not match its filename")
            return profile
        except (ValidationError, ValueError, UnicodeDecodeError) as exc:
            raise CorruptProfile(f"profile {name} contains invalid JSON or data") from exc

    def _write(self, profile: Profile) -> None:
        path = self._path(profile.name)
        payload = profile.model_dump_json(indent=2) + "\n"
        temp_name: str | None = None
        try:
            fd, temp_name = tempfile.mkstemp(prefix=f".{profile.name}.", suffix=".tmp", dir=self.directory)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, path)
            dir_fd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError as exc:
            if temp_name is not None:
                try:
                    os.unlink(temp_name)
                except OSError:
                    pass
            raise StorageError(f"could not save profile {profile.name}: {exc}") from exc

    @staticmethod
    def _next_timestamp(previous: int = 0) -> int:
        return max(time.time_ns() // 1_000_000, previous + 1)

    def create(self, name: str, tree: BookmarkTree) -> Profile:
        with self._locked():
            path = self._path(name)
            if path.exists():
                raise ProfileExists(name)
            profile = Profile(name=name, updated_at=self._next_timestamp(), tree=tree)
            self._write(profile)
            return profile

    def get(self, name: str) -> Profile:
        self.validate_name(name)
        with self._locked():
            return self._read(name)

    def update(self, name: str, base_updated_at: int, tree: BookmarkTree) -> Profile:
        with self._locked():
            current = self._read(name)
            if current.updated_at != base_updated_at:
                raise RevisionConflict(current)
            updated = Profile(name=name, updated_at=self._next_timestamp(current.updated_at), tree=tree)
            self._write(updated)
            return updated

    def rename(self, old_name: str, new_name: str, base_updated_at: int) -> Profile:
        self.validate_name(old_name)
        self.validate_name(new_name)
        with self._locked():
            current = self._read(old_name)
            if current.updated_at != base_updated_at:
                raise RevisionConflict(current)
            if old_name == new_name:
                updated = Profile(name=new_name, updated_at=self._next_timestamp(current.updated_at), tree=current.tree)
                self._write(updated)
                return updated
            new_path = self._path(new_name)
            if new_path.exists():
                raise ProfileExists(new_name)
            updated = Profile(name=new_name, updated_at=self._next_timestamp(current.updated_at), tree=current.tree)
            self._write(updated)
            self._path(old_name).unlink()
            return updated

    @staticmethod
    def bookmark_count(tree: BookmarkTree) -> int:
        count = 0
        stack = [node for root in (tree.roots.toolbar, tree.roots.menu, tree.roots.other, tree.roots.mobile) for node in root]
        while stack:
            node = stack.pop()
            if isinstance(node, Bookmark):
                count += 1
            if isinstance(node, Folder):
                stack.extend(node.children)
        return count

    def list_profiles(self) -> list[ProfileSummary]:
        with self._locked():
            summaries = []
            for path in sorted(self.directory.glob("*.json")):
                name = path.stem
                if not PROFILE_RE.fullmatch(name):
                    continue
                profile = self._read(name)  # Corruption intentionally fails the whole request visibly.
                summaries.append(ProfileSummary(name=name, updated_at=profile.updated_at, bookmark_count=self.bookmark_count(profile.tree)))
            return summaries
