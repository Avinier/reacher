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
    `- Filters found: ${detail.filters.length}`,
    `- Sources captured: ${detail.sources.length}`,
    "",
    "## Targets",
    "",
    targets || "No targets saved yet."
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
      targets: detail.targets,
      drafts: []
    },
    null,
    2
  );
}
