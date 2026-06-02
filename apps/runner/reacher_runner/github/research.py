from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote_plus

import httpx


GITHUB_API_URL = "https://api.github.com"
GITHUB_WEB_URL = "https://github.com"


@dataclass(frozen=True)
class GitHubQuerySpec:
    kind: str
    query: str
    reason: str


@dataclass(frozen=True)
class GitHubContactPath:
    kind: str
    value: str
    source_url: str
    confidence: float


@dataclass(frozen=True)
class GitHubCreatorSignal:
    login: str
    html_url: str
    role: str
    contributions: int | None = None
    name: str | None = None
    company: str | None = None
    blog: str | None = None
    email: str | None = None
    contact_paths: list[GitHubContactPath] = field(default_factory=list)


@dataclass(frozen=True)
class GitHubUserSignal:
    repo_full_name: str
    html_url: str
    signal_type: str
    evidence: str
    owner_login: str | None = None
    owner_url: str | None = None
    contact_paths: list[GitHubContactPath] = field(default_factory=list)


@dataclass(frozen=True)
class GitHubProjectSignal:
    full_name: str
    html_url: str
    owner_login: str
    owner_type: str
    owner_url: str
    description: str
    homepage: str | None
    language: str | None
    stars: int
    forks: int
    open_issues: int
    pushed_at: str | None
    topics: list[str] = field(default_factory=list)
    languages: dict[str, int] = field(default_factory=dict)
    readme_excerpt: str = ""
    package_contact_paths: list[GitHubContactPath] = field(default_factory=list)
    creators: list[GitHubCreatorSignal] = field(default_factory=list)
    users: list[GitHubUserSignal] = field(default_factory=list)
    score: float = 0.0
    why_relevant: str = ""


@dataclass(frozen=True)
class GitHubResearchResult:
    prompt: str
    queries: list[GitHubQuerySpec]
    projects: list[GitHubProjectSignal] = field(default_factory=list)
    users: list[GitHubUserSignal] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _compact(value: str, max_length: int = 120) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    if len(compact) <= max_length:
        return compact
    truncated = compact[:max_length].rsplit(" ", 1)[0]
    return truncated or compact[:max_length]


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        key = value.lower()
        if value and key not in seen:
            output.append(value)
            seen.add(key)
    return output


def _extract_prompt_queries(prompt: str) -> list[str]:
    match = re.search(r"search queries:\s*(.*?)(?:\n\s*(?:pain signals|disqualify|output):|\Z)", prompt, flags=re.I | re.S)
    if not match:
        return []
    queries: list[str] = []
    for line in match.group(1).splitlines():
        cleaned = line.strip()
        if cleaned.startswith(("-", "*")):
            query = _compact(cleaned[1:].strip(), 180)
            if query:
                queries.append(query)
    return queries


def _search_terms(prompt: str) -> str:
    prompt_queries = _extract_prompt_queries(prompt)
    if prompt_queries:
        return _compact(prompt_queries[0], 100)
    cleaned = re.sub(r"\b(find|companies|projects|users|creators|maintainers|outreach|mail|email)\b", " ", prompt, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return _compact(cleaned or prompt or "developer tools", 100)


def build_github_queries(prompt: str, planned_queries: list[str] | None = None) -> list[GitHubQuerySpec]:
    topic = _search_terms(prompt)
    raw_queries = [*_extract_prompt_queries(prompt), *(planned_queries or [])]
    repo_queries = _dedupe(
        [_compact(query, 180) for query in raw_queries if query]
        + [
            f"{topic} in:name,description,readme archived:false",
            f"{topic} stars:>25 pushed:>2025-01-01 archived:false",
            f"{topic} topic:ai archived:false",
        ]
    )
    issue_queries = _dedupe(
        [
            f"{topic} type:issue state:open comments:>2",
            f"{topic} pain OR flaky OR slow OR broken type:issue",
        ]
    )
    code_queries = _dedupe(
        [
            f'"{topic}" filename:package.json',
            f'"{topic}" filename:pyproject.toml OR filename:requirements.txt',
        ]
    )

    specs: list[GitHubQuerySpec] = []
    specs.extend(GitHubQuerySpec("repositories", query, "Project/company discovery from repository metadata and README.") for query in repo_queries[:5])
    specs.extend(GitHubQuerySpec("issues", query, "Pain and buying-intent discovery from public issues and PRs.") for query in issue_queries[:3])
    specs.extend(GitHubQuerySpec("code", query, "Likely user/adopter discovery from dependency or usage references.") for query in code_queries[:2])
    return specs


def _contact_paths_from_text(text: str, source_url: str, confidence: float = 0.62) -> list[GitHubContactPath]:
    contacts: list[GitHubContactPath] = []
    for email in _dedupe(re.findall(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)):
        if email.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".svg")):
            continue
        contacts.append(GitHubContactPath("email", email, source_url, confidence))
    for url in _dedupe(re.findall(r"https?://[^\s)>\"]+", text)):
        cleaned = url.rstrip(".,;")
        kind = "website"
        if "linkedin.com/" in cleaned:
            kind = "linkedin"
        elif "x.com/" in cleaned or "twitter.com/" in cleaned:
            kind = "x"
        contacts.append(GitHubContactPath(kind, cleaned, source_url, min(confidence, 0.58)))
    return contacts[:8]


def _contact_paths_from_profile(profile: dict[str, Any]) -> list[GitHubContactPath]:
    source_url = str(profile.get("html_url") or "")
    contacts: list[GitHubContactPath] = []
    email = str(profile.get("email") or "").strip()
    if email:
        contacts.append(GitHubContactPath("email", email, source_url, 0.88))
    blog = str(profile.get("blog") or "").strip()
    if blog:
        value = blog if blog.startswith(("http://", "https://")) else f"https://{blog}"
        contacts.append(GitHubContactPath("website", value, source_url, 0.72))
    twitter = str(profile.get("twitter_username") or "").strip()
    if twitter:
        contacts.append(GitHubContactPath("x", f"https://x.com/{twitter}", source_url, 0.7))
    company = str(profile.get("company") or "").strip()
    if company and "." in company and " " not in company:
        contacts.append(GitHubContactPath("company_domain", company.removeprefix("@"), source_url, 0.45))
    return contacts


def _score_project(repo: dict[str, Any], readme: str, creators: list[GitHubCreatorSignal], users: list[GitHubUserSignal], package_contacts: list[GitHubContactPath]) -> float:
    stars = int(repo.get("stargazers_count") or 0)
    open_issues = int(repo.get("open_issues_count") or 0)
    score = 0.42
    score += min(stars, 1000) / 2500
    score += 0.12 if repo.get("pushed_at") else 0
    score += 0.08 if repo.get("homepage") else 0
    score += 0.08 if creators else 0
    score += 0.08 if users else 0
    score += 0.06 if package_contacts else 0
    score += min(open_issues, 50) / 500
    score += 0.04 if readme else 0
    return round(max(0.0, min(score, 0.98)), 3)


class GitHubResearchClient:
    def __init__(self, token: str | None = None):
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Reacher local GitHub outreach research",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.client = httpx.Client(base_url=GITHUB_API_URL, timeout=25, follow_redirects=True, headers=headers)

    def close(self) -> None:
        self.client.close()

    def research(
        self,
        prompt: str,
        *,
        planned_queries: list[str] | None = None,
        max_repositories: int = 8,
        max_users: int = 8,
    ) -> GitHubResearchResult:
        queries = build_github_queries(prompt, planned_queries=planned_queries)
        errors: list[str] = []
        repos: list[dict[str, Any]] = []
        user_signals: list[GitHubUserSignal] = []

        for spec in queries:
            try:
                if spec.kind == "repositories":
                    repos.extend(self.search_repositories(spec.query, per_page=5))
                elif spec.kind == "issues":
                    user_signals.extend(self.search_issue_users(spec.query, limit=max_users))
                elif spec.kind == "code":
                    user_signals.extend(self.search_code_users(spec.query, limit=max_users))
            except Exception as error:  # noqa: BLE001 - persisted as run evidence
                errors.append(f"github {spec.kind} [{spec.query[:80]}]: {error}")

        deduped_repos: list[dict[str, Any]] = []
        seen_repos: set[str] = set()
        for repo in repos:
            full_name = str(repo.get("full_name") or "")
            if full_name and full_name not in seen_repos:
                deduped_repos.append(repo)
                seen_repos.add(full_name)

        projects: list[GitHubProjectSignal] = []
        for repo in deduped_repos[:max_repositories]:
            try:
                projects.append(self.enrich_project(repo, prompt, user_signals=user_signals))
            except Exception as error:  # noqa: BLE001
                errors.append(f"github enrich {repo.get('full_name')}: {error}")

        return GitHubResearchResult(
            prompt=prompt,
            queries=queries,
            projects=sorted(projects, key=lambda project: project.score, reverse=True),
            users=user_signals[:max_users],
            errors=errors,
        )

    def search_repositories(self, query: str, per_page: int = 5) -> list[dict[str, Any]]:
        payload = self._get_json(f"/search/repositories?q={quote_plus(query)}&sort=stars&order=desc&per_page={max(1, min(per_page, 20))}")
        return [item for item in payload.get("items", []) if isinstance(item, dict)]

    def search_issue_users(self, query: str, limit: int = 8) -> list[GitHubUserSignal]:
        payload = self._get_json(f"/search/issues?q={quote_plus(query)}&sort=updated&order=desc&per_page={max(1, min(limit, 20))}")
        signals: list[GitHubUserSignal] = []
        for item in payload.get("items", []):
            if not isinstance(item, dict):
                continue
            repo_url = str(item.get("repository_url") or "")
            full_name = repo_url.removeprefix(f"{GITHUB_API_URL}/repos/")
            user = item.get("user") if isinstance(item.get("user"), dict) else {}
            login = str(user.get("login") or "")
            signals.append(
                GitHubUserSignal(
                    repo_full_name=full_name,
                    html_url=str(item.get("html_url") or ""),
                    signal_type="issue_or_pr",
                    evidence=_compact(str(item.get("title") or ""), 220),
                    owner_login=login or None,
                    owner_url=str(user.get("html_url") or "") or None,
                )
            )
        return signals[:limit]

    def search_code_users(self, query: str, limit: int = 8) -> list[GitHubUserSignal]:
        payload = self._get_json(f"/search/code?q={quote_plus(query)}&per_page={max(1, min(limit, 20))}")
        signals: list[GitHubUserSignal] = []
        for item in payload.get("items", []):
            if not isinstance(item, dict):
                continue
            repo = item.get("repository") if isinstance(item.get("repository"), dict) else {}
            owner = repo.get("owner") if isinstance(repo.get("owner"), dict) else {}
            signals.append(
                GitHubUserSignal(
                    repo_full_name=str(repo.get("full_name") or ""),
                    html_url=str(item.get("html_url") or ""),
                    signal_type="code_reference",
                    evidence=f"{item.get('name') or 'code file'} references the query terms.",
                    owner_login=str(owner.get("login") or "") or None,
                    owner_url=str(owner.get("html_url") or "") or None,
                )
            )
        return signals[:limit]

    def enrich_project(self, repo: dict[str, Any], prompt: str, *, user_signals: list[GitHubUserSignal]) -> GitHubProjectSignal:
        full_name = str(repo.get("full_name") or "")
        owner = repo.get("owner") if isinstance(repo.get("owner"), dict) else {}
        owner_login = str(owner.get("login") or full_name.split("/")[0])
        details = self._safe_get_json(f"/repos/{full_name}") or repo
        topics = list(details.get("topics") or repo.get("topics") or [])
        languages = self._safe_get_json(f"/repos/{full_name}/languages") or {}
        readme = self.get_readme(full_name)
        package_contacts = self.package_contact_paths(full_name)
        creators = self.creator_signals(full_name, limit=3)
        users = [signal for signal in user_signals if signal.repo_full_name and signal.repo_full_name != full_name][:4]
        score = _score_project(details, readme, creators, users, package_contacts)
        why = self._why_project(details, prompt, creators, users, package_contacts)
        return GitHubProjectSignal(
            full_name=full_name,
            html_url=str(details.get("html_url") or repo.get("html_url") or f"{GITHUB_WEB_URL}/{full_name}"),
            owner_login=owner_login,
            owner_type=str(owner.get("type") or ""),
            owner_url=str(owner.get("html_url") or f"{GITHUB_WEB_URL}/{owner_login}"),
            description=str(details.get("description") or repo.get("description") or ""),
            homepage=str(details.get("homepage") or repo.get("homepage") or "") or None,
            language=details.get("language") or repo.get("language"),
            stars=int(details.get("stargazers_count") or repo.get("stargazers_count") or 0),
            forks=int(details.get("forks_count") or repo.get("forks_count") or 0),
            open_issues=int(details.get("open_issues_count") or repo.get("open_issues_count") or 0),
            pushed_at=details.get("pushed_at") or repo.get("pushed_at"),
            topics=[str(topic) for topic in topics],
            languages={str(key): int(value) for key, value in languages.items()} if isinstance(languages, dict) else {},
            readme_excerpt=_compact(readme, 900),
            package_contact_paths=package_contacts,
            creators=creators,
            users=users,
            score=score,
            why_relevant=why,
        )

    def creator_signals(self, full_name: str, limit: int = 3) -> list[GitHubCreatorSignal]:
        contributors = self._safe_get_json(f"/repos/{full_name}/contributors?per_page={max(1, min(limit, 10))}") or []
        creators: list[GitHubCreatorSignal] = []
        for contributor in contributors:
            if not isinstance(contributor, dict):
                continue
            login = str(contributor.get("login") or "")
            if not login:
                continue
            profile = self._safe_get_json(f"/users/{login}") or contributor
            contact_paths = _contact_paths_from_profile(profile)
            creators.append(
                GitHubCreatorSignal(
                    login=login,
                    html_url=str(profile.get("html_url") or contributor.get("html_url") or f"{GITHUB_WEB_URL}/{login}"),
                    role="top_contributor",
                    contributions=int(contributor.get("contributions") or 0),
                    name=str(profile.get("name") or "") or None,
                    company=str(profile.get("company") or "") or None,
                    blog=str(profile.get("blog") or "") or None,
                    email=str(profile.get("email") or "") or None,
                    contact_paths=contact_paths,
                )
            )
        return creators

    def get_readme(self, full_name: str) -> str:
        payload = self._safe_get_json(f"/repos/{full_name}/readme")
        if not payload or not isinstance(payload, dict):
            return ""
        content = str(payload.get("content") or "")
        if not content:
            return ""
        try:
            return base64.b64decode(content, validate=False).decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            return ""

    def package_contact_paths(self, full_name: str) -> list[GitHubContactPath]:
        contacts: list[GitHubContactPath] = []
        for path in ("package.json", "pyproject.toml", "README.md", "CODEOWNERS"):
            payload = self._safe_get_json(f"/repos/{full_name}/contents/{quote_plus(path)}")
            if not payload or not isinstance(payload, dict):
                continue
            content = str(payload.get("content") or "")
            text = ""
            if content:
                try:
                    text = base64.b64decode(content, validate=False).decode("utf-8", errors="replace")
                except Exception:  # noqa: BLE001
                    text = ""
            contacts.extend(_contact_paths_from_text(text, str(payload.get("html_url") or f"{GITHUB_WEB_URL}/{full_name}/blob/HEAD/{path}")))
        deduped: list[GitHubContactPath] = []
        seen: set[tuple[str, str]] = set()
        for contact in contacts:
            key = (contact.kind, contact.value.lower())
            if key not in seen:
                deduped.append(contact)
                seen.add(key)
        return deduped[:10]

    def _why_project(
        self,
        repo: dict[str, Any],
        prompt: str,
        creators: list[GitHubCreatorSignal],
        users: list[GitHubUserSignal],
        package_contacts: list[GitHubContactPath],
    ) -> str:
        parts = [f"Repository matched GitHub outreach research for '{_compact(prompt, 80)}'."]
        if repo.get("description"):
            parts.append(str(repo["description"])[:180])
        if creators:
            parts.append(f"Top contributor signal: {creators[0].login}.")
        if users:
            parts.append(f"Found {len(users)} likely user/adopter signals from issues or code search.")
        if package_contacts:
            parts.append(f"Found {len(package_contacts)} public contact-path signals in repo/profile metadata.")
        return " ".join(parts)

    def _get_json(self, path: str) -> Any:
        response = self.client.get(path)
        response.raise_for_status()
        return response.json()

    def _safe_get_json(self, path: str) -> Any:
        try:
            return self._get_json(path)
        except httpx.HTTPStatusError as error:
            if error.response.status_code in {403, 404, 451}:
                return None
            raise
