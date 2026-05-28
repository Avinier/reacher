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
    lines = [
        f"# Reacher Run {run_id}",
        "",
        f"Prompt: {run['prompt'] if run else ''}",
        f"Interpreted goal: {run['interpreted_goal'] if run else ''}",
        "",
        "## Strategy",
        "",
        "| Platform | Filter | Why |",
        "|---|---|---|",
    ]
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
    return "\n".join(lines)


def render_csv(conn: sqlite3.Connection, run_id: str) -> str:
    targets = _rows(conn, "SELECT * FROM targets WHERE run_id = ? ORDER BY relevance_score DESC", (run_id,))
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["rank", "platform", "target_type", "display_name", "handle", "profile_url", "organization", "role_or_context", "relevance_score", "why_relevant", "source_run_id"])
    for index, target in enumerate(targets, start=1):
        writer.writerow([index, target["platform"], target["target_type"], target["display_name"], target["handle"], target["profile_url"], target["organization"], target["role_or_context"], target["relevance_score"], target["why_relevant"], target["run_id"]])
    return output.getvalue()


def render_json(conn: sqlite3.Connection, run_id: str) -> str:
    run = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    payload = {
        "prompt": run["prompt"] if run else "",
        "interpreted_goal": run["interpreted_goal"] if run else None,
        "filters": [dict(row) for row in _rows(conn, "SELECT * FROM research_filters WHERE run_id = ?", (run_id,))],
        "sources": [dict(row) for row in _rows(conn, "SELECT * FROM sources WHERE run_id = ?", (run_id,))],
        "targets": [dict(row) for row in _rows(conn, "SELECT * FROM targets WHERE run_id = ?", (run_id,))],
        "drafts": [dict(row) for row in _rows(conn, "SELECT * FROM drafts WHERE run_id = ?", (run_id,))],
    }
    return json.dumps(payload, indent=2)
