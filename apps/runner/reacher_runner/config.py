from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local")


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


@dataclass(frozen=True)
class Config:
    root: Path
    database_path: Path
    data_dir: Path
    browserbase_api_key: str | None
    browserbase_project_id: str | None
    gemini_api_key: str | None
    google_agent_platform_api_key: str | None
    poll_interval_ms: int

    @property
    def browserbase_configured(self) -> bool:
        return bool(self.browserbase_api_key and self.browserbase_project_id)

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key)


def load_config() -> Config:
    data_dir_raw = os.getenv("REACHER_DATA_DIR", "./data")
    database_url = os.getenv("DATABASE_URL", "file:./data/reacher.sqlite")
    database_raw = database_url.removeprefix("file:")

    data_dir = (ROOT / data_dir_raw).resolve() if not Path(data_dir_raw).is_absolute() else Path(data_dir_raw)
    database_path = (ROOT / database_raw).resolve() if not Path(database_raw).is_absolute() else Path(database_raw)
    gemini_key = _first_env("GOOGLE_GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY")

    if gemini_key:
        os.environ.setdefault("GOOGLE_API_KEY", gemini_key)
        os.environ.setdefault("GEMINI_API_KEY", gemini_key)

    return Config(
        root=ROOT,
        database_path=database_path,
        data_dir=data_dir,
        browserbase_api_key=os.getenv("BROWSERBASE_API_KEY"),
        browserbase_project_id=os.getenv("BROWSERBASE_PROJECT_ID"),
        gemini_api_key=gemini_key,
        google_agent_platform_api_key=os.getenv("GOOGLE_AGENT_PLATFORM_API_KEY"),
        poll_interval_ms=int(os.getenv("REACHER_RUNNER_POLL_INTERVAL_MS", "1000")),
    )
