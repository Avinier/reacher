from __future__ import annotations

import csv
import io
import json
import sqlite3


def _rows(conn: sqlite3.Connection, sql: str, params: tuple[str, ...]) -> list[sqlite3.Row]:
    return list(conn.execute(sql, params).fetchall())


def render_markdown(conn: sqlite3.Connection, run_id: str) -> str:
    run = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    filters = _rows(conn, "SELECT * FROM research_filters WHERE run_id = ?", (run_id,))
    targets = _rows(conn, "SELECT * FROM targets WHERE run_id = ? ORDER BY relevance_score DESC", (run_id,))
    candidates = _rows(conn, "SELECT * FROM research_candidates WHERE run_id = ? ORDER BY confidence DESC, created_at LIMIT 20", (run_id,))
    scorecards = _rows(conn, "SELECT * FROM research_scorecards WHERE run_id = ? ORDER BY total_score DESC, created_at LIMIT 20", (run_id,))
    checkpoints = _rows(conn, "SELECT * FROM research_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 10", (run_id,))
    usage = conn.execute(
        "SELECT COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM run_usage_events WHERE run_id = ?",
        (run_id,),
    ).fetchone()
    usage_by_provider = _rows(
        conn,
        "SELECT provider, service, unit, COUNT(*) AS events, COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM run_usage_events WHERE run_id = ? GROUP BY provider, service, unit ORDER BY provider, service",
        (run_id,),
    )
    lines = [
        f"# Reacher Run {run_id}",
        "",
        f"Prompt: {run['prompt'] if run else ''}",
        f"Interpreted goal: {run['interpreted_goal'] if run else ''}",
        "",
        "## Usage",
        "",
        f"- Estimated cost: ${float(usage['estimated_cost_usd'] if usage else 0):.4f}",
        f"- Input tokens: {int(usage['input_tokens'] if usage else 0)}",
        f"- Output tokens: {int(usage['output_tokens'] if usage else 0)}",
        f"- Total tokens: {int(usage['total_tokens'] if usage else 0)}",
        "",
        "| Provider | Service | Quantity | Unit | Tokens | Estimated cost |",
        "|---|---|---:|---|---:|---:|",
    ]
    if usage_by_provider:
        lines.extend(
            f"| {item['provider']} | {item['service']} | {item['quantity']} | {item['unit']} | {item['total_tokens']} | ${float(item['estimated_cost_usd']):.4f} |"
            for item in usage_by_provider
        )
    else:
        lines.append("| - | - | 0 | - | 0 | $0.0000 |")
    lines.extend([
        "",
        "## Strategy",
        "",
        "| Platform | Filter | Why |",
        "|---|---|---|",
    ])
    lines.extend(f"| {item['platform']} | {item['value']} | {item['reason'] or ''} |" for item in filters)
    lines.extend(["", "## Targets", ""])
    for target in targets:
        lines.extend([
            f"### {target['display_name']}",
            f"- Platform: {target['platform']}",
            f"- URL: {target['profile_url'] or ''}",
            f"- Why relevant: {target['why_relevant'] or ''}",
            "",
        ])
    lines.extend([
        "",
        "## Code-mode state",
        "",
        f"- Candidates: {len(candidates)}",
        f"- Scorecards: {len(scorecards)}",
        f"- Recent checkpoints: {len(checkpoints)}",
        "",
        "| Candidate | Company | Role | Confidence |",
        "|---|---|---|---:|",
    ])
    if candidates:
        lines.extend(
            f"| {item['name']} | {item['company'] or ''} | {item['role'] or ''} | {item['confidence'] or ''} |"
            for item in candidates
        )
    else:
        lines.append("| - | - | - | - |")
    return "\n".join(lines)


def render_csv(conn: sqlite3.Connection, run_id: str) -> str:
    targets = _rows(conn, "SELECT * FROM targets WHERE run_id = ? ORDER BY relevance_score DESC", (run_id,))
    usage = conn.execute("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd FROM run_usage_events WHERE run_id = ?", (run_id,)).fetchone()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["rank", "platform", "target_type", "display_name", "handle", "profile_url", "organization", "role_or_context", "relevance_score", "why_relevant", "estimated_run_cost_usd", "source_run_id"])
    for index, target in enumerate(targets, start=1):
        writer.writerow([index, target["platform"], target["target_type"], target["display_name"], target["handle"], target["profile_url"], target["organization"], target["role_or_context"], target["relevance_score"], target["why_relevant"], usage["estimated_cost_usd"] if usage else 0, target["run_id"]])
    return output.getvalue()


def render_json(conn: sqlite3.Connection, run_id: str) -> str:
    run = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    payload = {
        "prompt": run["prompt"] if run else "",
        "interpreted_goal": run["interpreted_goal"] if run else None,
        "filters": [dict(row) for row in _rows(conn, "SELECT * FROM research_filters WHERE run_id = ?", (run_id,))],
        "sources": [dict(row) for row in _rows(conn, "SELECT * FROM sources WHERE run_id = ?", (run_id,))],
        "candidates": [dict(row) for row in _rows(conn, "SELECT * FROM research_candidates WHERE run_id = ? ORDER BY confidence DESC, created_at", (run_id,))],
        "enrichments": [dict(row) for row in _rows(conn, "SELECT * FROM research_enrichments WHERE run_id = ? ORDER BY created_at", (run_id,))],
        "scorecards": [dict(row) for row in _rows(conn, "SELECT * FROM research_scorecards WHERE run_id = ? ORDER BY total_score DESC, created_at", (run_id,))],
        "checkpoints": [dict(row) for row in _rows(conn, "SELECT * FROM research_checkpoints WHERE run_id = ? ORDER BY created_at", (run_id,))],
        "targets": [dict(row) for row in _rows(conn, "SELECT * FROM targets WHERE run_id = ?", (run_id,))],
        "drafts": [dict(row) for row in _rows(conn, "SELECT * FROM drafts WHERE run_id = ?", (run_id,))],
        "usage_summary": dict(conn.execute("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM run_usage_events WHERE run_id = ?", (run_id,)).fetchone()),
        "usage_events": [dict(row) for row in _rows(conn, "SELECT * FROM run_usage_events WHERE run_id = ? ORDER BY created_at", (run_id,))],
    }
    return json.dumps(payload, indent=2)
