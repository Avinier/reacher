from __future__ import annotations

from dataclasses import dataclass

from reacher_runner.config import Config


@dataclass
class BrowserSession:
    provider_session_id: str
    live_url: str | None


class BrowserbaseDriver:
    def __init__(self, config: Config):
        self.config = config

    def smoke_test_enabled(self) -> bool:
        return self.config.browserbase_configured

    def smoke_test(self) -> dict[str, str | bool]:
        if not self.smoke_test_enabled():
            return {"ok": False, "reason": "Browserbase credentials are not configured"}
        return {"ok": True, "reason": "Browserbase credentials are present; live session calls are intentionally gated"}

    def create_session(self, platform: str, context_id: str, run_id: str) -> BrowserSession:
        if not self.config.browserbase_configured:
            return BrowserSession(provider_session_id=f"local-{run_id}-{platform}", live_url=None)
        return BrowserSession(provider_session_id=f"browserbase-{run_id}-{platform}", live_url=None)

    def close_session(self, session: BrowserSession, persist_context: bool = True) -> None:
        _ = (session, persist_context)
