from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import types

from reacher_runner.config import Config
from reacher_runner.usage import UsageEvent, estimate_text_tokens, gemini_event


@dataclass(frozen=True)
class GeminiResult:
    ok: bool
    provider: str
    data: dict[str, Any] | None = None
    error: str | None = None
    usage_event: UsageEvent | None = None


def _json_from_text(text: str) -> dict[str, Any]:
    stripped = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", stripped, flags=re.S)
    if fenced:
        stripped = fenced.group(1).strip()
    return json.loads(stripped)


class GeminiResearchClient:
    def __init__(self, config: Config):
        self.config = config

    def enrich_yc_notes(self, companies: list[dict[str, Any]]) -> GeminiResult:
        payload = [
            {
                "name": company.get("name"),
                "one_liner": company.get("one_liner"),
                "description": str(company.get("long_description") or "")[:900],
                "tags": company.get("tags") or [],
                "location": company.get("location"),
                "team_size": company.get("team_size"),
            }
            for company in companies
        ]
        prompt = (
            "Return JSON only. For each YC Winter 2022 company below, write one concise outreach/research note "
            "that explains what the company does and what signal matters. Schema: "
            "{\"companies\":[{\"name\":\"\",\"note\":\"\"}]}. Companies: "
            f"{json.dumps(payload, ensure_ascii=False)}"
        )

        api_result = self._try_genai_api(prompt)
        if api_result.ok:
            return api_result
        cli_result = self._try_gemini_cli(prompt)
        if cli_result.ok:
            return cli_result
        return GeminiResult(ok=False, provider="none", error=f"genai: {api_result.error}; cli: {cli_result.error}")

    def plan_browserbase_queries(self, prompt: str, platforms: list[str]) -> GeminiResult:
        planning_prompt = (
            "Return JSON only. Break this outreach/deep-research request into concise Browserbase Search queries. "
            "Do not copy the full prompt into a query. Each query must be under 160 characters, specific, and usable "
            "as a web search query. Prefer exact quoted phrases, role/company/site constraints, and source-specific "
            "queries for YC, GitHub, LinkedIn, X/Twitter, Wellfound, Work at a Startup, HN, engineering blogs, and "
            "company careers pages when relevant. Use only these platforms when assigning query.platform: "
            f"{platforms}. Schema: {{\"interpreted_goal\":\"\",\"queries\":[{{\"platform\":\"web\",\"query\":\"\",\"reason\":\"\"}}]}}. "
            f"Research request: {prompt}"
        )
        api_result = self._try_genai_api(planning_prompt)
        if api_result.ok:
            return api_result
        cli_result = self._try_gemini_cli(planning_prompt)
        if cli_result.ok:
            return cli_result
        return GeminiResult(ok=False, provider="none", error=f"genai: {api_result.error}; cli: {cli_result.error}")

    def plan_reddit_queries(self, prompt: str) -> GeminiResult:
        planning_prompt = (
            "Return JSON only. Break this research request into concise Reddit search queries. "
            "Do not copy the full prompt into a query. Each query must be under 80 characters, specific, "
            "and optimized for Reddit's search.json endpoint. Prefer quoted phrases for exact matches, "
            "combine key terms rather than full sentences, and think about what Reddit users actually title "
            "their posts. Also suggest relevant subreddits to search in. "
            "Schema: {\"interpreted_goal\":\"\",\"queries\":[\"short search query\"],\"subreddits\":[\"subredditname\"]}. "
            f"Research request: {prompt}"
        )
        api_result = self._try_genai_api(planning_prompt)
        if api_result.ok:
            return api_result
        cli_result = self._try_gemini_cli(planning_prompt)
        if cli_result.ok:
            return cli_result
        return GeminiResult(ok=False, provider="none", error=f"genai: {api_result.error}; cli: {cli_result.error}")

    def aggregate_browserbase_research(self, prompt: str, pages: list[dict[str, Any]], max_targets: int = 50) -> GeminiResult:
        page_payload = [
            {
                "url": page.get("url"),
                "title": page.get("title"),
                "platform": page.get("platform"),
                "content": str(page.get("content") or "")[:1800],
            }
            for page in pages[:18]
            if page.get("url")
        ]
        aggregation_prompt = (
            "Return JSON only. Synthesize the fetched research evidence into ranked outreach prospects or source targets. "
            "Use the user's criteria. Prefer concrete people/companies over generic pages. Include only targets supported "
            "by the provided evidence, and include source_urls. Scores must be 0.0 to 1.0. "
            "Schema: {\"summary\":\"\",\"targets\":[{\"display_name\":\"\",\"url\":\"\",\"platform\":\"web\",\"target_type\":\"person|company|page|account\","
            "\"role_or_context\":\"\",\"relevance_score\":0.0,\"why_relevant\":\"\",\"evidence_summary\":\"\",\"outreach_angle\":\"\",\"source_urls\":[\"\"],"
            "\"metadata\":{\"company\":\"\",\"role\":\"\",\"stack_signals\":[],\"pain_signals\":[],\"scores\":{\"icp_fit\":1,\"pain_evidence\":1,\"reachability\":1,\"call_likelihood\":1,\"design_partner\":1}}}]}. "
            f"Return at most {max_targets} targets. User request: {prompt}. Evidence pages: {json.dumps(page_payload, ensure_ascii=False)}"
        )
        api_result = self._try_genai_api(aggregation_prompt)
        if api_result.ok:
            return api_result
        cli_result = self._try_gemini_cli(aggregation_prompt)
        if cli_result.ok:
            return cli_result
        return GeminiResult(ok=False, provider="none", error=f"genai: {api_result.error}; cli: {cli_result.error}")

    def _try_genai_api(self, prompt: str) -> GeminiResult:
        if not self.config.gemini_api_key:
            return GeminiResult(ok=False, provider="google-genai", error="Gemini API key is not configured")
        try:
            client = genai.Client(api_key=self.config.gemini_api_key)
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            usage = getattr(response, "usage_metadata", None)
            input_tokens = int(getattr(usage, "prompt_token_count", 0) or estimate_text_tokens(prompt))
            output_tokens = int(getattr(usage, "candidates_token_count", 0) or estimate_text_tokens(response.text or ""))
            return GeminiResult(
                ok=True,
                provider="google-genai",
                data=_json_from_text(response.text or "{}"),
                usage_event=gemini_event("google-genai", "gemini-2.5-flash", input_tokens, output_tokens, estimated=usage is None),
            )
        except Exception as error:  # noqa: BLE001 - surfaced in run steps
            return GeminiResult(ok=False, provider="google-genai", error=str(error))

    def _try_gemini_cli(self, prompt: str) -> GeminiResult:
        gemini = shutil.which("gemini")
        if not gemini:
            return GeminiResult(ok=False, provider="gemini-cli", error="gemini CLI is not installed")
        try:
            completed = subprocess.run(
                [gemini, "-m", "gemini-2.5-flash", "-p", prompt],
                check=False,
                capture_output=True,
                text=True,
                timeout=180,
            )
            if completed.returncode != 0:
                return GeminiResult(ok=False, provider="gemini-cli", error=(completed.stderr or completed.stdout).strip()[:1000])
            return GeminiResult(
                ok=True,
                provider="gemini-cli",
                data=_json_from_text(completed.stdout),
                usage_event=gemini_event(
                    "gemini-cli",
                    "gemini-2.5-flash",
                    estimate_text_tokens(prompt),
                    estimate_text_tokens(completed.stdout),
                    estimated=True,
                ),
            )
        except Exception as error:  # noqa: BLE001
            return GeminiResult(ok=False, provider="gemini-cli", error=str(error))
