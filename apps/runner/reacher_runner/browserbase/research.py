from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from time import perf_counter
from threading import Lock
from typing import Any

import httpx

from reacher_runner.config import Config
from reacher_runner.usage import UsageEvent, browserbase_fetch_event, browserbase_search_event, browserbase_session_event


BROWSERBASE_API_URL = "https://api.browserbase.com/v1"


@dataclass(frozen=True)
class BrowserbaseQuerySpec:
    platform: str
    query: str
    reason: str | None = None


@dataclass(frozen=True)
class BrowserbaseSearchResult:
    query: str
    title: str
    url: str
    platform: str
    author: str | None = None
    published_date: str | None = None


@dataclass(frozen=True)
class BrowserbaseFetchResult:
    url: str
    title: str
    platform: str
    status_code: int | None
    content_type: str | None
    content: str


@dataclass(frozen=True)
class BrowserbaseSynthesizedTarget:
    display_name: str
    url: str
    platform: str
    target_type: str = "page"
    role_or_context: str | None = None
    relevance_score: float = 0.72
    why_relevant: str = ""
    evidence_summary: str = ""
    outreach_angle: str | None = None
    source_urls: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BrowserbaseAgentSession:
    platform: str
    provider_session_id: str
    live_url: str
    recording_url: str
    connect_url: str | None = None


@dataclass(frozen=True)
class BrowserbaseDeepResearchResult:
    prompt: str
    platforms: list[str]
    queries: list[str]
    search_results: list[BrowserbaseSearchResult] = field(default_factory=list)
    fetched_pages: list[BrowserbaseFetchResult] = field(default_factory=list)
    synthesized_targets: list[BrowserbaseSynthesizedTarget] = field(default_factory=list)
    browser_sessions: list[BrowserbaseAgentSession] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _compact_query(value: str, max_length: int = 180) -> str:
    query = " ".join(value.replace("\n", " ").split())
    query = re.sub(r"^\s*[-*]\s*", "", query)
    if len(query) <= max_length:
        return query
    terms = re.findall(r'"[^"]+"|site:\S+|[A-Za-z0-9][A-Za-z0-9+./:_-]*', query)
    compact = " ".join(terms[:24])
    return compact[:max_length].strip() or query[:max_length].strip()


def _platform_for_query(query: str, platforms: list[str]) -> str:
    lowered = query.lower()
    if any(host in lowered for host in ("x.com", "twitter.com")) and "x" in platforms:
        return "x"
    if "linkedin.com" in lowered and "linkedin" in platforms:
        return "linkedin"
    if any(host in lowered for host in ("discord.com", "discord.gg")) and "discord" in platforms:
        return "discord"
    return "web"


def _extract_prompt_queries(prompt: str) -> list[str]:
    match = re.search(r"search queries:\s*(.*?)(?:\n\s*(?:pain signals|disqualify|output):|\Z)", prompt, flags=re.I | re.S)
    if not match:
        return []
    queries: list[str] = []
    for line in match.group(1).splitlines():
        cleaned = line.strip()
        if not cleaned or not cleaned.startswith(("-", "*")):
            continue
        query = _compact_query(cleaned)
        if query:
            queries.append(query)
    return queries


def build_research_queries(prompt: str, platforms: list[str], planned_queries: list[dict[str, Any]] | None = None) -> list[BrowserbaseQuerySpec]:
    queries: list[BrowserbaseQuerySpec] = []
    seen: set[str] = set()

    def add(platform: str, query: str, reason: str | None = None) -> None:
        if platform not in platforms and platform != "web":
            platform = "web"
        compact = _compact_query(query)
        if not compact:
            return
        key = f"{platform}:{compact.lower()}"
        if key in seen:
            return
        seen.add(key)
        queries.append(BrowserbaseQuerySpec(platform=platform, query=compact, reason=reason))

    for item in planned_queries or []:
        if not isinstance(item, dict):
            continue
        add(str(item.get("platform") or "web"), str(item.get("query") or ""), str(item.get("reason") or "") or None)

    for query in _extract_prompt_queries(prompt):
        add(_platform_for_query(query, platforms), query, "Query provided in the research prompt.")

    topic = _compact_query(prompt, 120) or "developer outreach"

    if "web" in platforms:
        add("web", f"{topic} site:news.ycombinator.com", "Hacker News discussion discovery.")
        add("web", f"{topic} site:ycombinator.com/companies", "YC company discovery.")
        add("web", f"{topic} site:github.com", "GitHub organization and stack-signal discovery.")
        add("web", f"{topic} site:workatastartup.com", "Hiring and team-size signal discovery.")
        add("web", f"{topic} site:wellfound.com", "Startup founder and role discovery.")
    if "x" in platforms:
        add("x", f"{topic} site:x.com", "X/Twitter public signal discovery.")
    if "linkedin" in platforms:
        add("linkedin", f"{topic} site:linkedin.com/in", "LinkedIn profile discovery.")
        add("linkedin", f"{topic} site:linkedin.com/company", "LinkedIn company discovery.")
    if "discord" in platforms:
        add("discord", f"{topic} site:discord.com/invite OR site:discord.gg", "Discord community discovery.")

    add("web", topic, "Broad fallback query.")
    return queries[:14]


class BrowserbaseResearchClient:
    def __init__(self, config: Config, usage_recorder: Any = None):
        if not config.browserbase_api_key:
            raise ValueError("BROWSERBASE_API_KEY is required for Browserbase research")
        self.config = config
        self.usage_recorder = usage_recorder
        self.client = httpx.Client(
            base_url=BROWSERBASE_API_URL,
            timeout=30,
            headers={
                "Content-Type": "application/json",
                "X-BB-API-Key": config.browserbase_api_key,
            },
        )
        self._usage_events: list[UsageEvent] = []
        self._usage_lock = Lock()

    def close(self) -> None:
        self.client.close()

    def record_usage(self, event: UsageEvent) -> None:
        with self._usage_lock:
            self._usage_events.append(event)

    def flush_usage(self) -> None:
        if not self.usage_recorder:
            return
        with self._usage_lock:
            events = list(self._usage_events)
            self._usage_events.clear()
        for event in events:
            self.usage_recorder(event)

    def research(
        self,
        prompt: str,
        platforms: list[str],
        *,
        context_ids: dict[str, str] | None = None,
        planned_queries: list[dict[str, Any]] | None = None,
        synthesized_targets: list[BrowserbaseSynthesizedTarget] | None = None,
        max_results_per_query: int = 5,
        max_fetches: int = 12,
    ) -> BrowserbaseDeepResearchResult:
        context_ids = context_ids or {}
        query_specs = build_research_queries(prompt, platforms, planned_queries=planned_queries)
        errors: list[str] = []
        search_results: list[BrowserbaseSearchResult] = []
        fetched_pages: list[BrowserbaseFetchResult] = []
        browser_sessions: list[BrowserbaseAgentSession] = []

        def run_search(spec: BrowserbaseQuerySpec) -> list[BrowserbaseSearchResult]:
            return self.search_web(spec.query, platform=spec.platform, num_results=max_results_per_query)

        with ThreadPoolExecutor(max_workers=min(6, max(1, len(query_specs)))) as executor:
            future_to_spec = {executor.submit(run_search, spec): spec for spec in query_specs}
            for future in as_completed(future_to_spec):
                spec = future_to_spec[future]
                try:
                    search_results.extend(future.result())
                except Exception as error:  # noqa: BLE001 - persisted as run evidence
                    errors.append(f"search {spec.platform} {spec.query}: {error}")
        self.flush_usage()

        deduped_results: list[BrowserbaseSearchResult] = []
        seen_urls: set[str] = set()
        for result in search_results:
            if result.url in seen_urls:
                continue
            deduped_results.append(result)
            seen_urls.add(result.url)

        fetch_candidates = deduped_results[:max_fetches]

        def run_fetch(result: BrowserbaseSearchResult) -> BrowserbaseFetchResult:
            return self.fetch_url(result.url, title=result.title, platform=result.platform)

        with ThreadPoolExecutor(max_workers=min(6, max(1, len(fetch_candidates)))) as executor:
            future_to_result = {executor.submit(run_fetch, result): result for result in fetch_candidates}
            for future in as_completed(future_to_result):
                result = future_to_result[future]
                try:
                    fetched_pages.append(future.result())
                except Exception as error:  # noqa: BLE001
                    errors.append(f"fetch {result.url}: {error}")
        self.flush_usage()

        rendered_count = 0
        for result in deduped_results:
            if rendered_count >= 3:
                break
            context_id = context_ids.get(result.platform)
            if result.platform not in {"linkedin", "x", "discord"} or not context_id:
                continue
            try:
                page, session = self.fetch_rendered_url(result.url, title=result.title, platform=result.platform, context_id=context_id)
                fetched_pages.append(page)
                browser_sessions.append(session)
                rendered_count += 1
            except Exception as error:  # noqa: BLE001
                errors.append(f"browser render {result.platform} {result.url}: {error}")
        self.flush_usage()

        return BrowserbaseDeepResearchResult(
            prompt=prompt,
            platforms=platforms,
            queries=[spec.query for spec in query_specs],
            search_results=deduped_results,
            fetched_pages=fetched_pages,
            synthesized_targets=synthesized_targets or [],
            browser_sessions=browser_sessions,
            errors=errors,
        )

    def search_web(self, query: str, *, platform: str, num_results: int = 5) -> list[BrowserbaseSearchResult]:
        response = self.client.post("/search", json={"query": query, "numResults": max(1, min(num_results, 25))})
        response.raise_for_status()
        payload = response.json()
        results: list[BrowserbaseSearchResult] = []
        for item in payload.get("results", []):
            url = str(item.get("url") or "")
            title = str(item.get("title") or url)
            if not url:
                continue
            results.append(
                BrowserbaseSearchResult(
                    query=query,
                    platform=platform,
                    title=title,
                    url=url,
                    author=item.get("author"),
                    published_date=item.get("publishedDate"),
                )
            )
        self.record_usage(browserbase_search_event(query, len(results)))
        return results

    def fetch_url(self, url: str, *, title: str, platform: str) -> BrowserbaseFetchResult:
        proxied = platform in {"x", "linkedin", "discord"}
        payload: dict[str, Any] = {
            "url": url,
            "allowRedirects": True,
            "proxies": proxied,
            "format": "markdown",
        }
        response = self.client.post("/fetch", json=payload)
        response.raise_for_status()
        data = response.json()
        result = BrowserbaseFetchResult(
            url=url,
            title=title,
            platform=platform,
            status_code=data.get("statusCode"),
            content_type=data.get("contentType"),
            content=str(data.get("content") or "")[:5000],
        )
        self.record_usage(browserbase_fetch_event(url, proxied=proxied, status_code=result.status_code))
        return result

    def create_session(self, *, platform: str, context_id: str | None) -> BrowserbaseAgentSession:
        body: dict[str, Any] = {
            "projectId": self.config.browserbase_project_id,
            "userMetadata": {"app": "reacher", "platform": platform, "purpose": "deep_research"},
        }
        if context_id:
            body["browserSettings"] = {"context": {"id": context_id, "persist": True}}
        response = self.client.post("/sessions", json=body)
        response.raise_for_status()
        payload = response.json()
        session_id = str(payload["id"])
        live_url = f"https://browserbase.com/sessions/{session_id}"
        return BrowserbaseAgentSession(
            platform=platform,
            provider_session_id=session_id,
            live_url=live_url,
            recording_url=live_url,
            connect_url=payload.get("connectUrl"),
        )

    def fetch_rendered_url(
        self,
        url: str,
        *,
        title: str,
        platform: str,
        context_id: str,
    ) -> tuple[BrowserbaseFetchResult, BrowserbaseAgentSession]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as error:  # pragma: no cover - depends on optional runtime install
            raise RuntimeError("Playwright is required for rendered Browserbase research. Run `uv sync` in apps/runner.") from error

        session = self.create_session(platform=platform, context_id=context_id)
        if not session.connect_url:
            raise RuntimeError("Browserbase session did not return a connectUrl")

        with sync_playwright() as playwright:
            started = perf_counter()
            browser = playwright.chromium.connect_over_cdp(session.connect_url)
            try:
                context = browser.contexts[0] if browser.contexts else browser.new_context()
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                page.wait_for_timeout(1500)
                rendered_title = page.title() or title
                content = page.locator("body").inner_text(timeout=10_000)
            finally:
                browser.close()
                self.record_usage(browserbase_session_event(platform, session.provider_session_id, perf_counter() - started))

        return (
            BrowserbaseFetchResult(
                url=url,
                title=rendered_title,
                platform=platform,
                status_code=200,
                content_type="text/rendered-browser",
                content=content[:5000],
            ),
            session,
        )
