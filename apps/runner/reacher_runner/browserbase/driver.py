from __future__ import annotations

from dataclasses import dataclass

import httpx

from reacher_runner.config import Config


@dataclass
class BrowserSession:
    provider_session_id: str
    live_url: str | None
    connect_url: str | None = None


class BrowserbaseDriver:
    def __init__(self, config: Config):
        self.config = config

    def smoke_test_enabled(self) -> bool:
        return self.config.browserbase_configured

    def smoke_test(self) -> dict[str, str | bool]:
        if not self.smoke_test_enabled():
            return {"ok": False, "reason": "Browserbase credentials are not configured"}
        return {"ok": True, "reason": "Browserbase credentials are present; Search, Fetch, and browser sessions are enabled"}

    def create_session(self, platform: str, context_id: str, run_id: str) -> BrowserSession:
        if not self.config.browserbase_configured:
            return BrowserSession(provider_session_id=f"local-{run_id}-{platform}", live_url=None)
        payload = {
            "projectId": self.config.browserbase_project_id,
            "browserSettings": {"context": {"id": context_id, "persist": True}},
            "userMetadata": {"app": "reacher", "runId": run_id, "platform": platform},
        }
        response = httpx.post(
            "https://api.browserbase.com/v1/sessions",
            json=payload,
            timeout=30,
            headers={"Content-Type": "application/json", "X-BB-API-Key": self.config.browserbase_api_key or ""},
        )
        response.raise_for_status()
        data = response.json()
        session_id = str(data["id"])
        return BrowserSession(
            provider_session_id=session_id,
            live_url=f"https://browserbase.com/sessions/{session_id}",
            connect_url=data.get("connectUrl"),
        )

    def close_session(self, session: BrowserSession, persist_context: bool = True) -> None:
        _ = (session, persist_context)
