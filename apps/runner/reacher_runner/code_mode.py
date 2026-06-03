from __future__ import annotations

import ast
import collections
import json
import math
import random
import re
import statistics
import string
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from reacher_runner.artifacts.writer import ArtifactWriter
from reacher_runner.browserbase.research import BrowserbaseFetchResult, BrowserbaseResearchClient, BrowserbaseSearchResult
from reacher_runner.db import ReacherDb


CODE_MODE_SDK_DOC = """
You are generating Python for Reacher code-mode research. Write JSON with a single key `code`.
The code must define `def run(sdk):`.
Use only the provided `sdk`; do not open files, call subprocess, or use network libraries.
Allowed imports: collections, json, math, random, re, statistics, string.
Use normal Python loops, branches, filtering, sorting, and early termination to reduce noisy results before saving.
Do not return large raw search/fetch payloads to the model; checkpoint compact counts, samples, and final decisions.
Useful SDK methods:
- sdk.checkpoint(name, data): persist intermediate JSON state.
- sdk.search_many([{"platform":"web","query":"..."}, ...], limit=8): concurrent Browserbase Search.
- sdk.fetch_many(results_or_urls, limit=30): concurrent Browserbase Fetch.
- sdk.save_candidates([...]): persist intermediate candidate dictionaries.
- sdk.save_enrichments(candidate_id, [...]): persist evidence dictionaries for a candidate.
- sdk.save_scorecards([...]): persist scorecards with 1-5 scores.
- sdk.save_targets([...]): persist final ranked targets.
- sdk.estimate_cost(): read current cost/tokens.
- sdk.exclusions(): read rerun exclusion URLs/names and feedback lists; use these before fetching or saving.
Candidate dict fields: name, company, role, url, platform, source_url, reason, confidence.
Enrichment dict fields: query, platform, url, title, summary, evidence_type, confidence, status, error.
Scorecard fields: candidate_id, icp_fit, pain_evidence, reachability, call_likelihood, design_partner, rationale.
Target fields: candidate_id, display_name, url, platform, target_type, role_or_context, relevance_score, why_relevant, evidence_summary, outreach_angle, source_urls, metadata.
For named-person prospecting, save only real people as final targets: name, company, founder/CTO/Head of Engineering role, profile URL, and evidence. Job posts, docs, generic pages, Reddit threads, and search-result titles are sources only, not targets.
For prospecting, discover broadly, dedupe before fetch, enrich likely candidates, then save 30-50 final named prospects.
Prefer one script that performs many SDK calls programmatically over many model round trips.
"""

SAFE_IMPORTS = {
    "collections": collections,
    "json": json,
    "math": math,
    "random": random,
    "re": re,
    "statistics": statistics,
    "string": string,
}


@dataclass(frozen=True)
class CodeModeResult:
    ok: bool
    generated_code: str
    artifact_path: str | None = None
    error: str | None = None
    output: Any = None


def _reject_unsafe_code(code: str) -> None:
    tree = ast.parse(code)
    disallowed_nodes = (ast.Global, ast.Nonlocal)
    disallowed_calls = {"eval", "exec", "compile", "open", "__import__", "input", "breakpoint"}
    for node in ast.walk(tree):
        if isinstance(node, disallowed_nodes):
            raise ValueError("Generated code may not mutate global/nonlocal state.")
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_name = alias.name.split(".", 1)[0]
                if root_name not in SAFE_IMPORTS:
                    raise ValueError(f"Generated code may not import {alias.name}. Allowed imports: {', '.join(sorted(SAFE_IMPORTS))}.")
        if isinstance(node, ast.ImportFrom):
            root_name = (node.module or "").split(".", 1)[0]
            if node.level or root_name not in SAFE_IMPORTS:
                raise ValueError(f"Generated code may not import from {node.module or ''}. Allowed imports: {', '.join(sorted(SAFE_IMPORTS))}.")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ValueError("Generated code may not access dunder attributes.")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise ValueError("Generated code may not access dunder names.")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in disallowed_calls:
            raise ValueError(f"Generated code may not call {node.func.id}.")


def _safe_import(name: str, globals: Any = None, locals: Any = None, fromlist: tuple[str, ...] = (), level: int = 0) -> Any:
    root_name = name.split(".", 1)[0]
    if level or root_name not in SAFE_IMPORTS:
        raise ImportError(f"Import is not allowed: {name}")
    return SAFE_IMPORTS[root_name]


class ResearchCodeModeSdk:
    def __init__(
        self,
        *,
        run_id: str,
        prompt: str,
        db: ReacherDb,
        browserbase: BrowserbaseResearchClient,
        platforms: list[str],
        exclusions: dict[str, Any] | None = None,
    ):
        self.run_id = run_id
        self.prompt = prompt
        self.db = db
        self.browserbase = browserbase
        self.platforms = platforms
        self._exclusions = exclusions or {"active": False, "urls": [], "names": [], "not_useful": {"urls": [], "names": []}, "outreached": {"urls": [], "names": []}}
        self._candidate_ids_by_key: dict[str, str] = {}

    def checkpoint(self, name: str, data: Any) -> None:
        self.db.save_research_checkpoint(self.run_id, name=name, data=data)

    def estimate_cost(self) -> dict[str, Any]:
        return self.db.usage_summary(self.run_id)

    def exclusions(self) -> dict[str, Any]:
        return self._exclusions

    def search_many(self, queries: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
        normalized = []
        for item in queries[:80]:
            query = str(item.get("query") or "").strip()
            if not query:
                continue
            platform = str(item.get("platform") or "web")
            if platform not in self.platforms and platform != "web":
                platform = "web"
            normalized.append({"query": query[:180], "platform": platform})

        results: list[BrowserbaseSearchResult] = []
        with ThreadPoolExecutor(max_workers=min(10, max(1, len(normalized)))) as executor:
            future_to_query = {
                executor.submit(self.browserbase.search_web, item["query"], platform=item["platform"], num_results=limit): item
                for item in normalized
            }
            for future in as_completed(future_to_query):
                item = future_to_query[future]
                try:
                    results.extend(future.result())
                except Exception as error:  # noqa: BLE001
                    self.db.add_step(self.run_id, "fetch", "Code-mode search warning", f"{item['platform']} {item['query']}: {error}", status="failed")
        self.browserbase.flush_usage()
        return [result.__dict__ for result in self._dedupe_search_results(results)]

    def fetch_many(self, inputs: list[Any], limit: int = 30) -> list[dict[str, Any]]:
        candidates = []
        for item in inputs[:limit]:
            if isinstance(item, dict):
                url = str(item.get("url") or "").strip()
                title = str(item.get("title") or url)
                platform = str(item.get("platform") or "web")
            else:
                url = str(item).strip()
                title = url
                platform = "web"
            if url:
                if self._excluded_url(url):
                    continue
                candidates.append({"url": url, "title": title, "platform": platform})

        pages: list[BrowserbaseFetchResult] = []
        with ThreadPoolExecutor(max_workers=min(10, max(1, len(candidates)))) as executor:
            future_to_item = {
                executor.submit(self.browserbase.fetch_url, item["url"], title=item["title"], platform=item["platform"]): item
                for item in candidates
            }
            for future in as_completed(future_to_item):
                item = future_to_item[future]
                try:
                    pages.append(future.result())
                except Exception as error:  # noqa: BLE001
                    self.db.add_step(self.run_id, "fetch", "Code-mode fetch warning", f"{item['url']}: {error}", status="failed")
        self.browserbase.flush_usage()
        return [page.__dict__ for page in pages]

    def save_candidates(self, candidates: list[dict[str, Any]]) -> list[str]:
        ids = []
        for candidate in candidates:
            if self._excluded_candidate(candidate):
                continue
            candidate_id = self.db.save_research_candidate(self.run_id, candidate)
            key = self._candidate_key(candidate)
            if key:
                self._candidate_ids_by_key[key] = candidate_id
            ids.append(candidate_id)
        return ids

    def save_enrichments(self, candidate_id: str, enrichments: list[dict[str, Any]]) -> list[str]:
        return [self.db.save_research_enrichment(self.run_id, candidate_id, enrichment) for enrichment in enrichments]

    def save_scorecards(self, scorecards: list[dict[str, Any]]) -> list[str]:
        return [self.db.save_research_scorecard(self.run_id, scorecard) for scorecard in scorecards]

    def save_targets(self, targets: list[dict[str, Any]]) -> list[str]:
        return self.db.save_code_mode_targets(self.run_id, self.prompt, targets)

    def candidate_id_for(self, candidate: dict[str, Any]) -> str | None:
        return self._candidate_ids_by_key.get(self._candidate_key(candidate))

    def _dedupe_search_results(self, results: list[BrowserbaseSearchResult]) -> list[BrowserbaseSearchResult]:
        seen = set()
        deduped = []
        for result in results:
            if result.url in seen:
                continue
            seen.add(result.url)
            deduped.append(result)
        return deduped

    def _candidate_key(self, candidate: dict[str, Any]) -> str:
        return "|".join(
            str(candidate.get(key) or "").strip().lower()
            for key in ("name", "company", "url")
        )

    def _excluded_url(self, url: Any) -> bool:
        normalized = str(url or "").strip().lower().split("#", 1)[0].rstrip("/")
        if normalized.startswith("http://"):
            normalized = "https://" + normalized[len("http://"):]
        if normalized.startswith("https://www."):
            normalized = "https://" + normalized[len("https://www."):]
        return bool(normalized and normalized in set(self._exclusions.get("urls") or []))

    def _excluded_candidate(self, candidate: dict[str, Any]) -> bool:
        if self._invalid_named_prospect_candidate(candidate):
            return True
        if self._excluded_url(candidate.get("url")) or self._excluded_url(candidate.get("source_url")):
            return True
        name = str(candidate.get("name") or candidate.get("display_name") or "").strip().lower()
        company = str(candidate.get("company") or "").strip().lower()
        key = f"{name}|{company}" if name or company else ""
        return bool(key and key in set(self._exclusions.get("names") or []))

    def _invalid_named_prospect_candidate(self, candidate: dict[str, Any]) -> bool:
        return False


class ResearchCodeModeExecutor:
    def __init__(self, db: ReacherDb, data_dir: Path):
        self.db = db
        self.writer = ArtifactWriter(data_dir)

    def execute(self, *, run_id: str, code: str, sdk: ResearchCodeModeSdk) -> CodeModeResult:
        artifact_path = self.writer.write_text(f"runs/{run_id}/code_mode/research.py", code)
        self.db.add_artifact(run_id, "other", artifact_path, "Generated code-mode research script")
        try:
            _reject_unsafe_code(code)
            namespace: dict[str, Any] = {
                "__builtins__": {
                    "len": len,
                    "range": range,
                    "min": min,
                    "max": max,
                    "sum": sum,
                    "sorted": sorted,
                    "str": str,
                    "int": int,
                    "float": float,
                    "bool": bool,
                    "list": list,
                    "dict": dict,
                    "set": set,
                    "enumerate": enumerate,
                    "zip": zip,
                    "isinstance": isinstance,
                    "getattr": getattr,
                    "round": round,
                    "any": any,
                    "all": all,
                    "Exception": Exception,
                    "print": print,
                    "__import__": _safe_import,
                }
            }
            exec(compile(code, artifact_path, "exec"), namespace)  # noqa: S102 - code is AST-gated and sandboxed.
            run_fn = namespace.get("run")
            if not callable(run_fn):
                raise ValueError("Generated code must define run(sdk).")
            output = run_fn(sdk)
            return CodeModeResult(ok=True, generated_code=code, artifact_path=artifact_path, output=output)
        except Exception as error:  # noqa: BLE001
            return CodeModeResult(
                ok=False,
                generated_code=code,
                artifact_path=artifact_path,
                error=f"{error}\n{traceback.format_exc(limit=5)}",
            )


def fallback_code_for_prompt(prompt: str) -> str:
    prompt_json = json.dumps(prompt)
    return f'''
import re

def run(sdk):
    queries = [
        {{"platform": "web", "query": "\\"Founder CTO\\" \\"AWS\\" \\"B2B SaaS\\""}},
        {{"platform": "web", "query": "\\"Technical Co-Founder\\" \\"GitHub Actions\\" \\"AWS\\""}},
        {{"platform": "web", "query": "\\"Founder CTO\\" \\"Postgres\\" \\"SaaS\\""}},
        {{"platform": "web", "query": "\\"Head of Engineering\\" \\"AWS\\" \\"Seed\\""}},
        {{"platform": "web", "query": "\\"Founder\\" \\"Terraform\\" \\"SaaS\\""}},
        {{"platform": "web", "query": "\\"technical founder\\" \\"production\\" \\"AWS\\""}},
        {{"platform": "web", "query": "\\"CTO\\" \\"ECS\\" \\"GitHub Actions\\" \\"Postgres\\""}},
        {{"platform": "web", "query": "site:ycombinator.com/companies \\"AWS\\" \\"B2B\\""}},
        {{"platform": "web", "query": "site:workatastartup.com \\"CTO\\" \\"AWS\\""}},
        {{"platform": "web", "query": "site:wellfound.com \\"technical cofounder\\" \\"AWS\\""}},
        {{"platform": "linkedin", "query": "\\"Founder CTO\\" \\"AWS\\" site:linkedin.com/in"}},
        {{"platform": "linkedin", "query": "\\"Head of Engineering\\" \\"SaaS\\" site:linkedin.com/in"}},
        {{"platform": "x", "query": "\\"technical founder\\" \\"production\\" \\"AWS\\" site:x.com"}},
        {{"platform": "web", "query": "site:theorg.com/org \\"Founder\\" \\"CTO\\" \\"AWS\\""}},
        {{"platform": "web", "query": "site:producthunt.com/products \\"Founder CTO\\" \\"SaaS\\""}},
        {{"platform": "web", "query": "site:news.ycombinator.com \\"Founder CTO\\" \\"AWS\\" \\"SaaS\\""}},
    ]
    sdk.checkpoint("code_mode_queries", {{"prompt": {prompt_json}, "queries": queries}})
    results = sdk.search_many(queries, limit=10)
    sdk.checkpoint("code_mode_search_results", {{"count": len(results), "sample": results[:10]}})

    role_pattern = r"(?:Founder\\s*&?\\s*CTO|Founder-CTO|Co-Founder\\s*/?\\s*CTO|Co-Founder\\s*&?\\s*CTO|Technical Co-Founder|Technical Cofounder|Founder|CTO|Chief Technology Officer|Head of Engineering|VP Engineering)"

    def clean(value):
        return " ".join(str(value or "").replace("|", " ").replace("—", " - ").split()).strip(" -")

    def slug_title(value):
        text = re.sub(r"[-_]+", " ", str(value or "").strip("/"))
        return " ".join(part.capitalize() for part in text.split() if part)

    def trim_person_name(value):
        parts = clean(value).split()
        publishers = {{"linkedin", "indianflux", "medium", "substack", "github", "wellfound", "himalayas"}}
        while len(parts) > 2 and parts[-1].lower().strip(".") in publishers:
            parts = parts[:-1]
        return " ".join(parts)

    def company_from_url(url):
        patterns = [
            r"ycombinator\\.com/companies/([^/?#]+)",
            r"wellfound\\.com/company/([^/?#]+)",
            r"wellfound\\.com/companies/([^/?#]+)",
            r"producthunt\\.com/products/([^/?#]+)",
            r"theorg\\.com/org/([^/?#]+)",
            r"workatastartup\\.com/companies/([^/?#]+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return slug_title(match.group(1))
        return ""

    def person_from_url(url):
        patterns = [
            r"linkedin\\.com/in/([^/?#]+)",
            r"x\\.com/([^/?#]+)",
            r"twitter\\.com/([^/?#]+)",
            r"theorg\\.com/org/[^/]+/org-chart/([^/?#]+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                value = match.group(1)
                if value.lower() not in ("home", "company", "share", "intent"):
                    return slug_title(value)
        return ""

    def person_from_title(title):
        founded_segment = re.search(r"founded\\s+by\\s+(.+?)(?:\\s+\\||$)", title, flags=re.I)
        if founded_segment:
            segment = clean(founded_segment.group(1))
            descriptor = re.search(r"(?:Leader|Founder|Engineer|Architect|Builder)\\s+([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){{1,2}})$", segment)
            if descriptor:
                return trim_person_name(descriptor.group(1))
        founded = re.search(r"founded\\s+by\\s+([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){{1,3}})", title, flags=re.I)
        if founded:
            founded_text = clean(founded.group(1))
            descriptor = re.search(r"(?:Leader|Founder|Engineer|Architect|Builder)\\s+([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){{1,2}})$", founded_text)
            return trim_person_name(descriptor.group(1)) if descriptor else trim_person_name(founded_text)
        first_part = clean(re.split(r"\\s+[-|:]\\s+", title)[0])
        if re.fullmatch(r"[A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){{1,3}}", first_part):
            return first_part
        return ""

    def infer_from_result(item):
        title = clean(item.get("title"))
        url = str(item.get("url") or "")
        platform = str(item.get("platform") or "web")
        query = clean(item.get("query"))
        combined = clean(title + " " + query)
        role_match = re.search(role_pattern, combined, flags=re.I)
        role = clean(role_match.group(0)) if role_match else ""
        company = company_from_url(url)
        name = ""

        name = person_from_title(title)
        if not name:
            name_pattern = r"([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){{1,3}})"
            patterns = [
                "^" + name_pattern + r"\\s+[-,]\\s+(" + role_pattern + r")\\s+(?:at|@)\\s+([^|,]+)",
                "^" + name_pattern + r"\\s+[-,]\\s+(" + role_pattern + r")",
                "^" + name_pattern + r".*?(" + role_pattern + r").*?(?:at|@)\\s+([^|,]+)",
            ]
            for pattern in patterns:
                match = re.search(pattern, title, flags=re.I)
                if match:
                    candidate_name = clean(match.group(1))
                    if candidate_name.lower().split(" ", 1)[0] in ("inside", "how", "what", "why", "lessons"):
                        continue
                    name = candidate_name
                    role = clean(match.group(2)) or role
                    if len(match.groups()) >= 3 and not company:
                        company = clean(match.group(3))
                    break
        if not name:
            name = person_from_url(url)
        if not company:
            company_match = re.search(r"\\bat\\s+([A-Z][A-Za-z0-9 .&-]{{2,50}})", title)
            if company_match:
                company = clean(re.split(r"\\s+[|,-]\\s+", company_match.group(1))[0])

        source_only = any(marker in url.lower() for marker in ["/jobs/", "/job/", "/docs/", "/documentation/", "/content/", "/questions/", "/comments/"])
        if name and role and not source_only:
            return {{
                "name": name[:120],
                "company": company[:120],
                "role": role[:120],
                "url": url,
                "platform": platform,
                "target_type": "person",
                "reason": "Search metadata identified a named founder/CTO/engineering-leader prospect.",
                "confidence": 0.72 if company else 0.62,
            }}
        if company and not ("docs.github.com" in url.lower() or "github.com/github/docs" in url.lower()):
            return {{
                "name": company[:120],
                "company": company[:120],
                "role": role or "Company prospect with founder/CTO or operational signal",
                "url": url,
                "platform": platform,
                "target_type": "company",
                "reason": "Search metadata identified a company/source worth prospecting for the prompt.",
                "confidence": 0.58 if source_only else 0.66,
            }}
        return None

    candidates = []
    seen = set()
    for item in results:
        candidate = infer_from_result(item)
        if not candidate:
            continue
        key = (candidate.get("target_type"), candidate.get("name", "").lower(), candidate.get("company", "").lower(), candidate.get("url", "").lower().split("#")[0].rstrip("/"))
        if key in seen:
            continue
        seen.add(key)
        candidate["source_url"] = candidate.get("url")
        candidate["metadata"] = {{"query": item.get("query"), "title": item.get("title"), "code_mode": "deterministic_fallback"}}
        candidates.append(candidate)
        if len(candidates) >= 120:
            break

    candidate_ids = sdk.save_candidates(candidates)
    saved_pairs = []
    for candidate in candidates:
        candidate_id = sdk.candidate_id_for(candidate)
        if candidate_id:
            saved_pairs.append((candidate_id, candidate))
    sdk.checkpoint("initial_candidates", {{"count": len(candidates), "saved": len(saved_pairs), "sample": candidates[:20]}})

    scorecards = []
    targets = []
    for index, pair in enumerate(saved_pairs[:100]):
        candidate_id, candidate = pair
        is_person = candidate.get("target_type") == "person"
        scorecards.append({{
            "candidate_id": candidate_id,
            "icp_fit": 4 if is_person else 3,
            "pain_evidence": 2,
            "reachability": 4 if is_person else 3,
            "call_likelihood": 3 if is_person else 2,
            "design_partner": 3,
            "rationale": "Deterministic code-mode score from search metadata; enrich before high-stakes outreach.",
        }})
        targets.append({{
            "candidate_id": candidate_id,
            "display_name": candidate.get("name"),
            "url": candidate.get("url"),
            "platform": candidate.get("platform") or "web",
            "target_type": candidate.get("target_type") or "company",
            "role_or_context": candidate.get("role"),
            "relevance_score": max(0.35, (0.82 if is_person else 0.68) - (index * 0.003)),
            "why_relevant": candidate.get("reason"),
            "evidence_summary": "Deterministic code-mode target inferred from search metadata. Needs enrichment before outreach.",
            "outreach_angle": "Ask about post-deploy operational closure if evidence confirms fit.",
            "source_urls": [candidate.get("url")],
            "metadata": {{
                "code_mode": "deterministic_fallback",
                "company": candidate.get("company"),
                "role": candidate.get("role"),
                "scores": {{"icp_fit": 4 if is_person else 3, "pain_evidence": 2, "reachability": 4 if is_person else 3, "call_likelihood": 3 if is_person else 2, "design_partner": 3}},
            }},
        }})
    sdk.save_scorecards(scorecards)
    sdk.save_targets(targets)
    sdk.checkpoint("code_mode_complete", {{"candidates": len(candidates), "targets": len(targets)}})
    return {{"targets": len(targets)}}
'''
