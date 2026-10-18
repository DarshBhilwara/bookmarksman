from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Bookmark(StrictModel):
    type: Literal["bookmark"]
    title: str = Field(max_length=4096)
    url: str = Field(min_length=1, max_length=8192)

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        # Browser bookmark URLs can include schemes beyond HTTP(S) (for example
        # mailto: and about:), so enforce a URL scheme without narrowing it.
        scheme = value.partition(":")[0]
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9+.-]*", scheme) or any(ord(char) < 0x20 for char in value):
            raise ValueError("bookmark URL must use a valid URI scheme")
        return value


class Folder(StrictModel):
    type: Literal["folder"]
    title: str = Field(max_length=4096)
    children: list["BookmarkNode"] = Field(max_length=10000)


class Separator(StrictModel):
    type: Literal["separator"]


BookmarkNode = Annotated[Bookmark | Folder | Separator, Field(discriminator="type")]


class Roots(StrictModel):
    toolbar: list[BookmarkNode] = Field(max_length=10000)
    menu: list[BookmarkNode] = Field(max_length=10000)
    other: list[BookmarkNode] = Field(max_length=10000)
    mobile: list[BookmarkNode] = Field(max_length=10000)


class BookmarkTree(StrictModel):
    roots: Roots

    @field_validator("roots")
    @classmethod
    def validate_tree_limits(cls, roots: Roots) -> Roots:
        count = 0
        # Use the validated objects to avoid re-parsing serialized data.
        stack = [(node, 1) for items in (roots.toolbar, roots.menu, roots.other, roots.mobile) for node in items]
        while stack:
            node, depth = stack.pop()
            count += 1
            if count > 50000:
                raise ValueError("bookmark tree exceeds 50000 items")
            if depth > 64:
                raise ValueError("bookmark tree exceeds maximum depth of 64")
            if isinstance(node, Folder):
                stack.extend((child, depth + 1) for child in node.children)
        return roots


class CreateProfile(StrictModel):
    tree: BookmarkTree


class UpdateProfile(StrictModel):
    base_updated_at: int = Field(strict=True, ge=0)
    tree: BookmarkTree


class RenameProfile(StrictModel):
    name: str = Field(min_length=1, max_length=64)
    base_updated_at: int = Field(strict=True, ge=0)


class Profile(StrictModel):
    schema_version: Literal[1] = 1
    name: str
    updated_at: int
    tree: BookmarkTree


class ProfileSummary(StrictModel):
    name: str
    updated_at: int
    bookmark_count: int

