from __future__ import annotations

from dataclasses import dataclass
from typing import Any


BROWSERBASE_SEARCH_USD_PER_CALL = 7 / 1000
BROWSERBASE_FETCH_USD_PER_CALL = 1 / 1000
BROWSERBASE_PROXY_FETCH_USD_PER_CALL = 4 / 1000
BROWSERBASE_BROWSER_USD_PER_SECOND = 0.12 / 3600

GEMINI_25_FLASH_INPUT_USD_PER_TOKEN = 0.30 / 1_000_000
GEMINI_25_FLASH_OUTPUT_USD_PER_TOKEN = 2.50 / 1_000_000


@dataclass(frozen=True)
class UsageEvent:
    provider: str
    service: str
    operation: str
    quantity: float
    unit: str
    unit_cost_usd: float | None
    estimated_cost_usd: float | None
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    model: str | None = None
    cost_basis: str = "estimated"
    metadata: dict[str, Any] | None = None


def estimate_text_tokens(text: str) -> int:
    return max(1, int(len(text) / 4))


def gemini_25_flash_cost(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * GEMINI_25_FLASH_INPUT_USD_PER_TOKEN) + (output_tokens * GEMINI_25_FLASH_OUTPUT_USD_PER_TOKEN)


def browserbase_search_event(query: str, result_count: int) -> UsageEvent:
    return UsageEvent(
        provider="browserbase",
        service="search",
        operation="search",
        quantity=1,
        unit="call",
        unit_cost_usd=BROWSERBASE_SEARCH_USD_PER_CALL,
        estimated_cost_usd=BROWSERBASE_SEARCH_USD_PER_CALL,
        cost_basis="estimated_overage_rate",
        metadata={"query": query, "result_count": result_count},
    )


def browserbase_fetch_event(url: str, proxied: bool, status_code: int | None) -> UsageEvent:
    unit_cost = BROWSERBASE_PROXY_FETCH_USD_PER_CALL if proxied else BROWSERBASE_FETCH_USD_PER_CALL
    return UsageEvent(
        provider="browserbase",
        service="fetch",
        operation="fetch_proxy" if proxied else "fetch",
        quantity=1,
        unit="call",
        unit_cost_usd=unit_cost,
        estimated_cost_usd=unit_cost,
        cost_basis="estimated_overage_rate",
        metadata={"url": url, "proxied": proxied, "status_code": status_code},
    )


def browserbase_session_event(platform: str, session_id: str, seconds: float) -> UsageEvent:
    cost = max(0, seconds) * BROWSERBASE_BROWSER_USD_PER_SECOND
    return UsageEvent(
        provider="browserbase",
        service="browser",
        operation="session_seconds",
        quantity=seconds,
        unit="second",
        unit_cost_usd=BROWSERBASE_BROWSER_USD_PER_SECOND,
        estimated_cost_usd=cost,
        cost_basis="estimated_overage_rate",
        metadata={"platform": platform, "session_id": session_id},
    )


def gemini_event(provider: str, model: str, input_tokens: int, output_tokens: int, estimated: bool) -> UsageEvent:
    total = input_tokens + output_tokens
    return UsageEvent(
        provider=provider,
        service="llm",
        operation="generate_content",
        quantity=total,
        unit="token",
        unit_cost_usd=None,
        estimated_cost_usd=gemini_25_flash_cost(input_tokens, output_tokens),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total,
        model=model,
        cost_basis="estimated_tokens" if estimated else "provider_token_metadata",
        metadata={
            "input_usd_per_1m_tokens": 0.30,
            "output_usd_per_1m_tokens": 2.50,
        },
    )
