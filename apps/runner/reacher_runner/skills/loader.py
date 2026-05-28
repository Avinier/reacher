from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LoadedSkill:
    path: Path
    content: str
    sha256: str


class SkillLoader:
    def __init__(self, skills_root: Path):
        self.skills_root = skills_root

    def _load_file(self, path: Path) -> LoadedSkill:
        content = path.read_text()
        return LoadedSkill(path=path, content=content, sha256=hashlib.sha256(content.encode()).hexdigest())

    def load(self, run_kind: str, platforms: list[str]) -> list[LoadedSkill]:
        files: list[Path] = []
        if run_kind == "outreach_prepare":
            files.append(self.skills_root / "global" / "outreach_prepare.md")
        else:
            files.append(self.skills_root / "global" / "research.md")

        for platform in platforms:
            if platform == "web":
                continue
            if run_kind == "outreach_prepare" and platform == "x":
                task_name = "dm_prepare.md"
            else:
                task_name = "message_prepare.md" if run_kind == "outreach_prepare" else "research.md"
            files.extend([
                self.skills_root / platform / task_name,
                self.skills_root / platform / "page_cues.md",
            ])

        existing = []
        seen: set[Path] = set()
        for path in files:
            if path.exists() and path not in seen:
                existing.append(self._load_file(path))
                seen.add(path)
        return existing
