import { getRunDetail } from "../db/repositories";

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function runMarkdown(runId: string) {
  const detail = getRunDetail(runId);
  if (!detail.run) throw new Error(`Run not found: ${runId}`);

  const filters = detail.filters.map((filter) => `| ${filter.platform} | ${filter.value} | ${filter.reason ?? ""} |`).join("\n");
  const targets = detail.targets.map((target) => {
    return [
      `### ${target.display_name}`,
      "",
      `- Platform: ${target.platform}`,
      `- URL: ${target.profile_url ?? ""}`,
      `- Relevance score: ${target.relevance_score ?? ""}`,
      `- Why relevant: ${target.why_relevant ?? ""}`
    ].join("\n");
  }).join("\n\n");

  return [
    `# Reacher Run ${runId}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Prompt: ${detail.run.prompt}`,
    `Interpreted goal: ${detail.run.interpreted_goal ?? ""}`,
    "",
    "## Strategy",
    "",
    "| Platform | Filter | Why |",
    "|---|---|---|",
    filters || "| - | - | - |",
    "",
    "## Summary",
    "",
    `- Targets found: ${detail.targets.length}`,
    `- Candidates explored: ${detail.candidates.length}`,
    `- Enrichments captured: ${detail.enrichments.length}`,
    `- Scorecards produced: ${detail.scorecards.length}`,
    `- Checkpoints saved: ${detail.checkpoints.length}`,
    `- Filters found: ${detail.filters.length}`,
    `- Sources captured: ${detail.sources.length}`,
    `- Estimated usage cost: $${Number(detail.usageSummary.estimated_cost_usd ?? 0).toFixed(4)}`,
    `- Gemini/input tokens: ${Number(detail.usageSummary.input_tokens ?? 0).toLocaleString()}`,
    `- Gemini/output tokens: ${Number(detail.usageSummary.output_tokens ?? 0).toLocaleString()}`,
    "",
    "## Usage",
    "",
    "| Provider | Service | Quantity | Unit | Tokens | Estimated cost |",
    "|---|---|---:|---|---:|---:|",
    detail.usageByProvider.map((usage) =>
      `| ${usage.provider} | ${usage.service} | ${usage.quantity} | ${usage.unit} | ${usage.total_tokens ?? 0} | $${Number(usage.estimated_cost_usd ?? 0).toFixed(4)} |`
    ).join("\n") || "| - | - | 0 | - | 0 | $0.0000 |",
    "",
    "## Targets",
    "",
    targets || "No targets saved yet.",
    "",
    "## Code-mode state",
    "",
    "| Candidate | Company | Role | Confidence |",
    "|---|---|---|---:|",
    detail.candidates.slice(0, 20).map((candidate) =>
      `| ${candidate.name ?? ""} | ${candidate.company ?? ""} | ${candidate.role ?? ""} | ${candidate.confidence ?? ""} |`
    ).join("\n") || "| - | - | - | - |"
  ].join("\n");
}

export function runCsv(runId: string) {
  const detail = getRunDetail(runId);
  const header = [
    "rank",
    "platform",
    "target_type",
    "display_name",
    "handle",
    "profile_url",
    "organization",
    "role_or_context",
    "relevance_score",
    "why_relevant",
    "estimated_run_cost_usd",
    "source_run_id"
  ];
  const rows = detail.targets.map((target, index) => [
    index + 1,
    target.platform,
    target.target_type,
    target.display_name,
    target.handle,
    target.profile_url,
    target.organization,
    target.role_or_context,
    target.relevance_score,
    target.why_relevant,
    detail.usageSummary.estimated_cost_usd,
    target.run_id
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function runJson(runId: string) {
  const detail = getRunDetail(runId);
  return JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      prompt: detail.run?.prompt ?? "",
      interpreted_goal: detail.run?.interpreted_goal ?? null,
      filters: detail.filters,
      sources: detail.sources,
      candidates: detail.candidates,
      enrichments: detail.enrichments,
      scorecards: detail.scorecards,
      checkpoints: detail.checkpoints,
      targets: detail.targets,
      drafts: [],
      usage_summary: detail.usageSummary,
      usage_by_provider: detail.usageByProvider,
      usage_events: detail.usage
    },
    null,
    2
  );
}
