from __future__ import annotations

from pathlib import Path


class ArtifactWriter:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir

    def write_text(self, relative_path: str, content: str) -> str:
        path = self.data_dir / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return str(path.relative_to(self.data_dir))
