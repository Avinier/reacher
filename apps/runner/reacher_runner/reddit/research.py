from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote_plus

import httpx


REDDIT_BASE = "https://www.reddit.com"


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

    def __init__(self, user_agent: str = "Reacher local research by u/_AVINIER"):
        self.client = httpx.Client(
            timeout=20,
            follow_redirects=True,
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json",
            },
        )
        self._last_request_at: float = 0.0

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

        for query in queries:
            search_targets = subreddits or [None]
            for subreddit in search_targets:
                if searches_run >= max_searches:
                    errors.append(f"Reddit search budget reached after {max_searches} query/subreddit attempts.")
                    break
                try:
                    searches_run += 1
                    posts.extend(self._search_posts(query, subreddit=subreddit, limit=limit))
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

        display_query = "; ".join(queries) if planned_queries else queries[0]
        return RedditResearchResult(query=display_query, subreddits=subreddits, posts=deduped_posts[:limit], comments=comments, errors=errors)

    def _search_posts(self, query: str, subreddit: str | None, limit: int) -> list[RedditPost]:
        encoded = quote_plus(query)
        if subreddit:
            url = f"{REDDIT_BASE}/r/{subreddit}/search.json?q={encoded}&restrict_sr=1&sort=relevance&t=year&limit={limit}"
        else:
            url = f"{REDDIT_BASE}/search.json?q={encoded}&type=link&sort=relevance&t=year&limit={limit}"
        payload = self._get_json(url)
        return [self._post_from_child(child) for child in payload.get("data", {}).get("children", []) if child.get("kind") == "t3"]

    def _top_comments(self, post_id: str, limit: int) -> list[RedditComment]:
        payload = self._get_json(f"{REDDIT_BASE}/comments/{post_id}.json?limit={limit}&sort=top")
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
        for attempt in range(self._MAX_RETRIES):
            response = self.client.get(url)
            if response.status_code == 429:
                retry_after = float(response.headers.get("Retry-After", 2 * (attempt + 1)))
                time.sleep(retry_after)
                continue
            response.raise_for_status()
            return response.json()
        # final attempt after all retries exhausted
        response = self.client.get(url)
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
