from __future__ import annotations

import html
import json
import re
from time import perf_counter
from dataclasses import dataclass, field
from typing import Any

from playwright.sync_api import Page, sync_playwright

from reacher_runner.browserbase.research import BrowserbaseAgentSession, BrowserbaseResearchClient, BrowserbaseSearchResult
from reacher_runner.usage import browserbase_session_event


YC_W22_DIRECTORY_URL = "https://www.ycombinator.com/companies?batch=Winter%202022"


@dataclass(frozen=True)
class YCCompanyResearch:
    rank: int
    name: str
    slug: str
    url: str
    batch: str
    one_liner: str
    long_description: str
    website: str | None
    location: str | None
    team_size: int | None
    status: str | None
    tags: list[str]
    company_socials: dict[str, str]
    founder_names: list[str] = field(default_factory=list)
    founder_social_results: list[BrowserbaseSearchResult] = field(default_factory=list)
    note: str | None = None


@dataclass(frozen=True)
class YCBatchResearchResult:
    prompt: str
    batch_name: str
    directory_url: str
    companies: list[YCCompanyResearch]
    browser_session: BrowserbaseAgentSession
    gemini_provider: str | None = None
    gemini_error: str | None = None
    errors: list[str] = field(default_factory=list)


def is_yc_w22_prompt(prompt: str) -> bool:
    normalized = prompt.lower()
    return "yc" in normalized and ("w22" in normalized or "winter 2022" in normalized or "2022 winter" in normalized)


def _clean_socials(company: dict[str, Any]) -> dict[str, str]:
    socials = {
        "website": company.get("website") or "",
        "linkedin": company.get("linkedin_url") or "",
        "x": company.get("twitter_url") or "",
        "github": company.get("github_url") or "",
        "facebook": company.get("fb_url") or "",
        "crunchbase": company.get("cb_url") or "",
    }
    return {key: value for key, value in socials.items() if value}


def _candidate_founder_names(company: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for founder in company.get("founders") or []:
        if isinstance(founder, dict) and founder.get("name"):
            names.append(str(founder["name"]))

    text = str(company.get("long_description") or "")
    patterns = [
        r"(?:founded|co-founded|headed|led) by ([^.]+)",
        r"(?:founders? are|cofounders? are) ([^.]+)",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.I):
            segment = re.split(r"\bteam\b|\bwho\b|\bthat\b|\bto\b", match)[0]
            parts = re.split(r",| and | & ", segment)
            for part in parts:
                cleaned = re.sub(r"\b(MD|PhD|CEO|CTO|COO|Dr\.?|Dra\.?)\b", "", part).strip(" -()")
                if re.search(r"[A-Z][a-z]+ [A-Z][A-Za-z]+", cleaned):
                    names.append(cleaned)

    seen: set[str] = set()
    deduped: list[str] = []
    for name in names:
        compact = " ".join(name.split())
        key = compact.lower()
        if compact and key not in seen:
            deduped.append(compact)
            seen.add(key)
    return deduped[:4]


def _extract_data_page_company(page: Page) -> dict[str, Any]:
    encoded = page.locator("[data-page]").first.get_attribute("data-page", timeout=15_000)
    if not encoded:
        raise RuntimeError("YC page did not expose data-page JSON")
    payload = json.loads(html.unescape(encoded))
    company = payload.get("props", {}).get("company")
    if not isinstance(company, dict):
        raise RuntimeError("YC company page data-page JSON did not contain props.company")
    return company


class YCBatchResearchClient:
    def __init__(self, browserbase: BrowserbaseResearchClient):
        self.browserbase = browserbase

    def research_w22_top_companies(self, prompt: str, *, limit: int = 30, notes_by_company: dict[str, str] | None = None) -> YCBatchResearchResult:
        session = self.browserbase.create_session(platform="web", context_id=None)
        errors: list[str] = []
        notes_by_company = notes_by_company or {}

        with sync_playwright() as playwright:
            started = perf_counter()
            browser = playwright.chromium.connect_over_cdp(session.connect_url)
            try:
                context = browser.contexts[0] if browser.contexts else browser.new_context()
                page = context.pages[0] if context.pages else context.new_page()
                links = self._collect_company_links(page, limit)
                companies: list[YCCompanyResearch] = []
                for index, link in enumerate(links, start=1):
                    try:
                        company = self._scrape_company(page, index, link["url"], notes_by_company)
                        companies.append(company)
                    except Exception as error:  # noqa: BLE001
                        errors.append(f"{link['url']}: {error}")
            finally:
                browser.close()
                self.browserbase.record_usage(browserbase_session_event("web", session.provider_session_id, perf_counter() - started))

        enriched: list[YCCompanyResearch] = []
        for company in companies:
            try:
                searches = self._find_founder_socials(company)
            except Exception as error:  # noqa: BLE001
                errors.append(f"social search {company.name}: {error}")
                searches = []
            enriched.append(
                YCCompanyResearch(
                    **{
                        **company.__dict__,
                        "founder_social_results": searches,
                    }
                )
            )

        return YCBatchResearchResult(
            prompt=prompt,
            batch_name="Winter 2022",
            directory_url=YC_W22_DIRECTORY_URL,
            companies=enriched,
            browser_session=session,
            errors=errors,
        )

    def _collect_company_links(self, page: Page, limit: int) -> list[dict[str, str]]:
        page.goto(YC_W22_DIRECTORY_URL, wait_until="networkidle", timeout=60_000)
        page.wait_for_timeout(2_000)
        previous_count = 0
        stable_rounds = 0
        while stable_rounds < 3:
            links = self._visible_company_links(page)
            if len(links) >= limit:
                return links[:limit]
            if len(links) == previous_count:
                stable_rounds += 1
            else:
                stable_rounds = 0
                previous_count = len(links)
            page.mouse.wheel(0, 4_000)
            page.wait_for_timeout(1_000)
        links = self._visible_company_links(page)
        if len(links) < limit:
            raise RuntimeError(f"Only found {len(links)} YC W22 companies, expected {limit}")
        return links[:limit]

    def _visible_company_links(self, page: Page) -> list[dict[str, str]]:
        raw = page.locator('a[href*="/companies/"]').evaluate_all(
            """els => els.map(a => ({text: a.innerText, url: a.href}))
              .filter(x => /\\/companies\\/[a-z0-9-]+$/.test(new URL(x.url).pathname))"""
        )
        seen: set[str] = set()
        links: list[dict[str, str]] = []
        for item in raw:
            url = str(item["url"])
            if url in seen:
                continue
            links.append({"url": url, "text": str(item.get("text") or "")})
            seen.add(url)
        return links

    def _scrape_company(self, page: Page, rank: int, url: str, notes_by_company: dict[str, str]) -> YCCompanyResearch:
        page.goto(url, wait_until="networkidle", timeout=60_000)
        company = _extract_data_page_company(page)
        name = str(company.get("name") or url.rsplit("/", 1)[-1])
        return YCCompanyResearch(
            rank=rank,
            name=name,
            slug=str(company.get("slug") or url.rsplit("/", 1)[-1]),
            url=url,
            batch=str(company.get("batch_name") or company.get("batch") or "Winter 2022"),
            one_liner=str(company.get("one_liner") or ""),
            long_description=str(company.get("long_description") or ""),
            website=company.get("website"),
            location=company.get("location"),
            team_size=company.get("team_size"),
            status=company.get("ycdc_status"),
            tags=[str(tag) for tag in company.get("tags") or []],
            company_socials=_clean_socials(company),
            founder_names=_candidate_founder_names(company),
            note=notes_by_company.get(name),
        )

    def _find_founder_socials(self, company: YCCompanyResearch) -> list[BrowserbaseSearchResult]:
        queries = []
        if company.founder_names:
            for name in company.founder_names[:2]:
                queries.append(f'"{name}" "{company.name}" founder LinkedIn OR X OR Twitter')
        queries.extend(
            [
                f'"{company.name}" YC W22 founder LinkedIn',
                f'"{company.name}" "Co-Founder" LinkedIn',
                f'"{company.name}" founders site:theorg.com OR site:foundertrace.com OR site:cbinsights.com',
            ]
        )
        results: list[BrowserbaseSearchResult] = []
        seen: set[str] = set()
        for query in queries[:5]:
            for result in self.browserbase.search_web(query, platform="web", num_results=8):
                url = result.url.lower()
                title = result.title.lower()
                is_personal_social = any(domain in url for domain in ["linkedin.com/in", "x.com/", "twitter.com/"])
                is_founder_directory = any(domain in url for domain in ["theorg.com/org", "foundertrace.com", "cbinsights.com/company"])
                title_has_founder_signal = any(term in title for term in ["founder", "co-founder", "cofounder", "ceo"])
                if not (is_personal_social or (is_founder_directory and title_has_founder_signal)):
                    continue
                if result.url in seen:
                    continue
                results.append(result)
                seen.add(result.url)
                if len(results) >= 4:
                    return results
        if not results:
            for label, url in company.company_socials.items():
                if label not in {"linkedin", "x", "github"}:
                    continue
                results.append(
                    BrowserbaseSearchResult(
                        query=f"{company.name} company social fallback",
                        title=f"{company.name} {label} company social",
                        url=url,
                        platform="web",
                    )
                )
                if len(results) >= 2:
                    break
        return results
