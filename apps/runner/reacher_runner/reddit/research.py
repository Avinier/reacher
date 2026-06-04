from __future__ import annotations

import re
import time
from hashlib import sha1
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote_plus

import httpx


REDDIT_BASE = "https://www.reddit.com"
REDDIT_OAUTH_BASE = "https://oauth.reddit.com"
REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token"


@dataclass(frozen=True)
class RedditPost:
    id: str
    title: str
    subreddit: str
    author: str | None
    permalink: str
    url: str
    score: int
    num_comments: int
    selftext: str
    created_utc: float | None


@dataclass(frozen=True)
class RedditComment:
    id: str
    post_id: str
    subreddit: str
    author: str | None
    body: str
    permalink: str
    score: int
    created_utc: float | None


@dataclass(frozen=True)
class RedditResearchResult:
    query: str
    subreddits: list[str]
    posts: list[RedditPost] = field(default_factory=list)
    comments: list[RedditComment] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _clean_query(prompt: str) -> str:
    query = re.sub(r"\br/[A-Za-z0-9_]+\b", " ", prompt)
    query = re.sub(r"\bsubreddit:[A-Za-z0-9_]+\b", " ", query, flags=re.I)
    query = re.sub(r"\s+", " ", query).strip()
    return query or prompt.strip() or "startup outreach"


def _truncate_query(query: str, max_length: int = 120) -> str:
    if len(query) <= max_length:
        return query
    truncated = query[:max_length].rsplit(" ", 1)[0]
    return truncated or query[:max_length]


def _normalize_subreddit(value: str) -> str:
    normalized = value.strip().removeprefix("r/").removeprefix("/r/").strip("_").lower()
    return normalized if re.fullmatch(r"[a-z0-9_]{2,21}", normalized) else ""


def _normalize_planned_query(value: str, max_length: int = 120) -> str:
    query = re.sub(r"\s+", " ", value).strip()
    return _truncate_query(query, max_length)


def _extract_subreddits(prompt: str) -> list[str]:
    found = re.findall(r"\br/([A-Za-z0-9_]+)\b", prompt)
    found.extend(re.findall(r"\bsubreddit:([A-Za-z0-9_]+)\b", prompt, flags=re.I))
    seen: set[str] = set()
    ordered: list[str] = []
    for subreddit in found:
        normalized = _normalize_subreddit(subreddit)
        if normalized and normalized not in seen:
            ordered.append(normalized)
            seen.add(normalized)
    return ordered


def _absolute_permalink(permalink: str) -> str:
    return permalink if permalink.startswith("http") else f"{REDDIT_BASE}{permalink}"


class RedditResearchClient:
    _REQUEST_GAP = 1.2  # seconds between requests (Reddit wants ~1/sec for unauthed)
    _MAX_RETRIES = 3

    def __init__(
        self,
        user_agent: str = "Reacher local research by u/_AVINIER",
        browserbase: "RedditBrowserbaseFallback | None" = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        devvit_client_id: str | None = None,
        devvit_refresh_token: str | None = None,
    ):
        self.client = httpx.Client(
            timeout=20,
            follow_redirects=True,
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json",
            },
        )
        self._last_request_at: float = 0.0
        self.browserbase = browserbase
        self._client_id = client_id
        self._client_secret = client_secret
        self._devvit_client_id = devvit_client_id
        self._devvit_refresh_token = devvit_refresh_token
        self._access_token: str | None = None
        self._token_expires_at: float = 0.0

    def _authenticate(self) -> bool:
        # Prefer Devvit refresh token (no secret needed)
        if self._devvit_client_id and self._devvit_refresh_token:
            try:
                response = self.client.post(
                    REDDIT_TOKEN_URL,
                    data={"grant_type": "refresh_token", "refresh_token": self._devvit_refresh_token},
                    auth=(self._devvit_client_id, ""),
                )
                response.raise_for_status()
                data = response.json()
                self._access_token = data["access_token"]
                self._token_expires_at = time.monotonic() + data.get("expires_in", 3600) - 60
                return True
            except Exception:  # noqa: BLE001
                pass
        # Fallback: application-only OAuth with client_id + client_secret
        if self._client_id and self._client_secret:
            try:
                response = self.client.post(
                    REDDIT_TOKEN_URL,
                    data={"grant_type": "client_credentials"},
                    auth=(self._client_id, self._client_secret),
                )
                response.raise_for_status()
                data = response.json()
                self._access_token = data["access_token"]
                self._token_expires_at = time.monotonic() + data.get("expires_in", 3600) - 60
                return True
            except Exception:  # noqa: BLE001
                pass
        return False

    def _ensure_token(self) -> bool:
        if self._access_token and time.monotonic() < self._token_expires_at:
            return True
        return self._authenticate()

    @property
    def _has_auth(self) -> bool:
        return bool((self._devvit_client_id and self._devvit_refresh_token) or (self._client_id and self._client_secret))

    @property
    def _base_url(self) -> str:
        if self._has_auth and self._ensure_token():
            return REDDIT_OAUTH_BASE
        return REDDIT_BASE

    def close(self) -> None:
        self.client.close()

    def research(
        self,
        prompt: str,
        limit: int = 8,
        comments_per_post: int = 3,
        planned_queries: list[str] | None = None,
        planned_subreddits: list[str] | None = None,
        max_searches: int = 30,
    ) -> RedditResearchResult:
        subreddits = _extract_subreddits(prompt)
        if planned_subreddits:
            seen = set(subreddits)
            for sub in planned_subreddits:
                normalized = _normalize_subreddit(sub)
                if normalized and normalized not in seen:
                    subreddits.append(normalized)
                    seen.add(normalized)

        queries: list[str]
        if planned_queries:
            queries = []
            seen_queries: set[str] = set()
            for planned_query in planned_queries:
                query = _normalize_planned_query(planned_query)
                key = query.lower()
                if query and key not in seen_queries:
                    queries.append(query)
                    seen_queries.add(key)
        else:
            queries = [_truncate_query(_clean_query(prompt))]
        if not queries:
            queries = [_truncate_query(_clean_query(prompt))]

        errors: list[str] = []
        posts: list[RedditPost] = []
        comments: list[RedditComment] = []
        searches_run = 0
        blocked_attempts = 0

        for query in queries:
            search_targets = subreddits or [None]
            for subreddit in search_targets:
                if searches_run >= max_searches:
                    errors.append(f"Reddit search budget reached after {max_searches} query/subreddit attempts.")
                    break
                if blocked_attempts >= 3:
                    errors.append("Reddit public JSON appears blocked for this network/session; skipping remaining Reddit searches.")
                    searches_run = max_searches
                    break
                try:
                    searches_run += 1
                    posts.extend(self._search_posts(query, subreddit=subreddit, limit=limit))
                    blocked_attempts = 0
                except httpx.HTTPStatusError as error:
                    if error.response.status_code == 403:
                        blocked_attempts += 1
                    label = f"r/{subreddit}" if subreddit else "global Reddit search"
                    errors.append(f"{label} [{query[:40]}]: {error}")
                except Exception as error:  # noqa: BLE001 - preserve Reddit failure in run evidence
                    label = f"r/{subreddit}" if subreddit else "global Reddit search"
                    errors.append(f"{label} [{query[:40]}]: {error}")
            if searches_run >= max_searches:
                break

        deduped_posts: list[RedditPost] = []
        seen_posts: set[str] = set()
        for post in posts:
            if post.id in seen_posts:
                continue
            deduped_posts.append(post)
            seen_posts.add(post.id)

        for post in deduped_posts[:limit]:
            try:
                comments.extend(self._top_comments(post.id, limit=comments_per_post))
            except Exception as error:  # noqa: BLE001
                errors.append(f"comments for {post.id}: {error}")

        if not deduped_posts and self._should_use_browserbase_fallback(errors):
            fallback = self._browserbase_fallback(queries, subreddits, limit=limit)
            posts.extend(fallback.posts)
            errors.extend(fallback.errors)

            deduped_posts = []
            seen_posts = set()
            for post in posts:
                if post.id in seen_posts:
                    continue
                deduped_posts.append(post)
                seen_posts.add(post.id)

        display_query = "; ".join(queries) if planned_queries else queries[0]
        return RedditResearchResult(query=display_query, subreddits=subreddits, posts=deduped_posts[:limit], comments=comments, errors=errors)

    def _should_use_browserbase_fallback(self, errors: list[str]) -> bool:
        if not getattr(self, "browserbase", None):
            return False
        return any("appears blocked" in error.lower() or "403" in error for error in errors)

    def _browserbase_fallback(self, queries: list[str], subreddits: list[str], limit: int) -> RedditResearchResult:
        errors: list[str] = ["Direct Reddit JSON was blocked; using Browserbase Search fallback for public Reddit results."]
        posts: list[RedditPost] = []
        search_targets = subreddits or [""]

        for query in queries[:5]:
            for subreddit in search_targets[:5]:
                if len(posts) >= limit:
                    break
                browser_query = self._browserbase_query(query, subreddit)
                try:
                    results = self.browserbase.search_web(browser_query, platform="reddit", num_results=min(limit, 8))
                except Exception as error:  # noqa: BLE001 - persist provider fallback failures
                    errors.append(f"browserbase reddit search [{browser_query[:60]}]: {error}")
                    continue

                for result in results:
                    post = self._post_from_browserbase_result(query, result)
                    if post:
                        posts.append(post)
                        if len(posts) >= limit:
                            break
            if len(posts) >= limit:
                break

        if not posts:
            errors.append("Browserbase Reddit fallback returned no usable reddit.com post results.")
        return RedditResearchResult(query="; ".join(queries), subreddits=subreddits, posts=posts[:limit], errors=errors)

    def _browserbase_query(self, query: str, subreddit: str) -> str:
        if subreddit:
            return f"site:reddit.com/r/{subreddit} {query}"
        return f"site:reddit.com/r/ {query}"

    def _post_from_browserbase_result(self, query: str, result: "BrowserbaseRedditSearchResult") -> RedditPost | None:
        url = str(getattr(result, "url", "") or "")
        title = str(getattr(result, "title", "") or url)
        if "reddit.com/" not in url:
            return None
        subreddit = _subreddit_from_url(url)
        if not subreddit:
            return None
        permalink = _canonical_reddit_url(url)
        summary = str(getattr(result, "summary", "") or "")
        post_id = _post_id_from_url(url) or sha1(url.encode("utf-8")).hexdigest()[:10]
        return RedditPost(
            id=post_id,
            title=title[:300],
            subreddit=subreddit,
            author=None,
            permalink=permalink,
            url=permalink,
            score=0,
            num_comments=0,
            selftext=f"Browserbase Search result for '{query}'. {summary}".strip(),
            created_utc=None,
        )

    def _search_posts(self, query: str, subreddit: str | None, limit: int) -> list[RedditPost]:
        encoded = quote_plus(query)
        base = self._base_url
        if subreddit:
            url = f"{base}/r/{subreddit}/search.json?q={encoded}&restrict_sr=1&sort=relevance&t=year&limit={limit}"
        else:
            url = f"{base}/search.json?q={encoded}&type=link&sort=relevance&t=year&limit={limit}"
        payload = self._get_json(url)
        return [self._post_from_child(child) for child in payload.get("data", {}).get("children", []) if child.get("kind") == "t3"]

    def _top_comments(self, post_id: str, limit: int) -> list[RedditComment]:
        payload = self._get_json(f"{self._base_url}/comments/{post_id}.json?limit={limit}&sort=top")
        if not isinstance(payload, list) or len(payload) < 2:
            return []
        children = payload[1].get("data", {}).get("children", [])
        comments: list[RedditComment] = []
        for child in children:
            if child.get("kind") != "t1":
                continue
            comments.append(self._comment_from_child(post_id, child))
            if len(comments) >= limit:
                break
        return comments

    def _get_json(self, url: str) -> Any:
        self._throttle()
        headers = {}
        if self._access_token and REDDIT_OAUTH_BASE in url:
            headers["Authorization"] = f"Bearer {self._access_token}"
        for attempt in range(self._MAX_RETRIES):
            response = self.client.get(url, headers=headers)
            if response.status_code == 429:
                retry_after = float(response.headers.get("Retry-After", 2 * (attempt + 1)))
                time.sleep(retry_after)
                continue
            response.raise_for_status()
            return response.json()
        # final attempt after all retries exhausted
        response = self.client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self._REQUEST_GAP:
            time.sleep(self._REQUEST_GAP - elapsed)
        self._last_request_at = time.monotonic()

    def _post_from_child(self, child: dict[str, Any]) -> RedditPost:
        data = child.get("data", {})
        return RedditPost(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            subreddit=str(data.get("subreddit", "")),
            author=None if data.get("author") in {None, "[deleted]"} else str(data.get("author")),
            permalink=_absolute_permalink(str(data.get("permalink", ""))),
            url=str(data.get("url") or _absolute_permalink(str(data.get("permalink", "")))),
            score=int(data.get("score") or 0),
            num_comments=int(data.get("num_comments") or 0),
            selftext=str(data.get("selftext") or ""),
            created_utc=float(data["created_utc"]) if data.get("created_utc") is not None else None,
        )

    def _comment_from_child(self, post_id: str, child: dict[str, Any]) -> RedditComment:
        data = child.get("data", {})
        return RedditComment(
            id=str(data.get("id", "")),
            post_id=post_id,
            subreddit=str(data.get("subreddit", "")),
            author=None if data.get("author") in {None, "[deleted]"} else str(data.get("author")),
            body=str(data.get("body") or ""),
            permalink=_absolute_permalink(str(data.get("permalink", ""))),
            score=int(data.get("score") or 0),
            created_utc=float(data["created_utc"]) if data.get("created_utc") is not None else None,
        )


class BrowserbaseRedditSearchResult(Protocol):
    query: str
    title: str
    url: str
    platform: str


class RedditBrowserbaseFallback(Protocol):
    def search_web(self, query: str, *, platform: str, num_results: int = 5) -> list[BrowserbaseRedditSearchResult]:
        ...


def _subreddit_from_url(url: str) -> str:
    match = re.search(r"reddit\.com/r/([A-Za-z0-9_]{2,21})(?:/|$)", url, flags=re.I)
    return _normalize_subreddit(match.group(1)) if match else ""


def _post_id_from_url(url: str) -> str:
    match = re.search(r"reddit\.com/r/[A-Za-z0-9_]+/comments/([A-Za-z0-9]+)", url, flags=re.I)
    return match.group(1) if match else ""


def _canonical_reddit_url(url: str) -> str:
    if url.startswith("/"):
        return _absolute_permalink(url)
    match = re.search(r"https?://(?:www\.|old\.|new\.)?reddit\.com([^?#]+)", url, flags=re.I)
    if match:
        return _absolute_permalink(match.group(1))
    return url
