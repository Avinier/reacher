import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = () => ({
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["research", "outreach_prepare", "reddit_write", "export", "context_verify"] }).notNull(),
    status: text("status", {
      enum: [
        "queued",
        "claimed",
        "running",
        "waiting_for_context",
        "waiting_for_operator",
        "completed",
        "failed",
        "cancelled",
        "interrupted"
      ]
    }).notNull(),
    prompt: text("prompt").notNull(),
    interpretedGoal: text("interpreted_goal"),
    settingsJson: text("settings_json", { mode: "json" }),
    resultSummary: text("result_summary"),
    errorMessage: text("error_message"),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt,
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" })
  },
  (table) => ({
    statusCreatedAtIdx: index("runs_status_created_at_idx").on(table.status, table.createdAt)
  })
);

export const runSteps = sqliteTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    status: text("status", { enum: ["pending", "running", "completed", "failed", "skipped"] }).notNull(),
    kind: text("kind", {
      enum: [
        "plan",
        "search",
        "fetch",
        "browser_session",
        "navigate",
        "observe",
        "act",
        "extract",
        "save",
        "draft",
        "export",
        "operator_wait"
      ]
    }).notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    inputJson: text("input_json", { mode: "json" }),
    outputJson: text("output_json", { mode: "json" }),
    artifactId: text("artifact_id"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" })
  },
  (table) => ({
    runIndexIdx: index("run_steps_run_id_index_idx").on(table.runId, table.index)
  })
);

export const runUsageEvents = sqliteTable(
  "run_usage_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    service: text("service").notNull(),
    operation: text("operation").notNull(),
    model: text("model"),
    quantity: real("quantity").notNull(),
    unit: text("unit").notNull(),
    unitCostUsd: real("unit_cost_usd"),
    estimatedCostUsd: real("estimated_cost_usd"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costBasis: text("cost_basis").notNull(),
    metadataJson: text("metadata_json", { mode: "json" }),
    createdAt: timestamps().createdAt
  },
  (table) => ({ runIdx: index("run_usage_events_run_id_idx").on(table.runId) })
);

export const integrations = sqliteTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    provider: text("provider", { enum: ["gmail"] }).notNull(),
    accountLabel: text("account_label"),
    accountEmail: text("account_email"),
    scopes: text("scopes"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    connectedAt: integer("connected_at", { mode: "timestamp_ms" }).notNull(),
    disconnectedAt: integer("disconnected_at", { mode: "timestamp_ms" }),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt
  },
  (table) => ({
    providerIdx: uniqueIndex("integrations_provider_idx").on(table.provider)
  })
);

export const browserContexts = sqliteTable(
  "browser_contexts",
  {
    id: text("id").primaryKey(),
    platform: text("platform", { enum: ["linkedin", "x", "reddit", "discord"] }).notNull(),
    displayName: text("display_name").notNull(),
    provider: text("provider").notNull().default("browserbase"),
    providerContextId: text("provider_context_id"),
    status: text("status", { enum: ["needs_login", "ready", "expired", "locked", "error"] }).notNull(),
    accountLabel: text("account_label"),
    lastVerifiedAt: integer("last_verified_at", { mode: "timestamp_ms" }),
    lastSessionId: text("last_session_id"),
    lastError: text("last_error"),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt
  },
  (table) => ({
    platformIdx: uniqueIndex("browser_contexts_platform_idx").on(table.platform)
  })
);

export const browserSessions = sqliteTable(
  "browser_sessions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    browserContextId: text("browser_context_id").references(() => browserContexts.id, { onDelete: "set null" }),
    providerSessionId: text("provider_session_id"),
    status: text("status", { enum: ["starting", "active", "closed", "failed"] }).notNull(),
    liveUrl: text("live_url"),
    recordingUrl: text("recording_url"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    lastUrl: text("last_url"),
    errorMessage: text("error_message")
  },
  (table) => ({
    runIdx: index("browser_sessions_run_id_idx").on(table.runId)
  })
);

export const researchFilters = sqliteTable(
  "research_filters",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["web", "linkedin", "x", "reddit", "discord"] }).notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    reason: text("reason"),
    confidence: real("confidence"),
    createdAt: timestamps().createdAt
  },
  (table) => ({ runIdx: index("research_filters_run_id_idx").on(table.runId) })
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["web", "linkedin", "x", "reddit", "discord"] }).notNull(),
    sourceType: text("source_type", {
      enum: ["search_result", "page", "profile", "post", "comment", "server", "channel", "conversation", "document"]
    }).notNull(),
    url: text("url"),
    title: text("title"),
    summary: text("summary"),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
    artifactId: text("artifact_id")
  },
  (table) => ({ runIdx: index("sources_run_id_idx").on(table.runId) })
);

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sourceRunId: text("source_run_id").references(() => runs.id, { onDelete: "set null" }),
  createdAt: timestamps().createdAt,
  updatedAt: timestamps().updatedAt
});

export const researchCandidates = sqliteTable(
  "research_candidates",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    role: text("role"),
    url: text("url"),
    platform: text("platform").notNull(),
    sourceUrl: text("source_url"),
    reason: text("reason"),
    confidence: real("confidence"),
    status: text("status").notNull(),
    metadataJson: text("metadata_json", { mode: "json" }),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt
  },
  (table) => ({ runIdx: index("research_candidates_run_id_idx").on(table.runId) })
);

export const researchEnrichments = sqliteTable(
  "research_enrichments",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id").references(() => researchCandidates.id, { onDelete: "cascade" }),
    query: text("query"),
    platform: text("platform").notNull(),
    url: text("url"),
    title: text("title"),
    summary: text("summary"),
    evidenceType: text("evidence_type"),
    confidence: real("confidence"),
    status: text("status").notNull(),
    error: text("error"),
    metadataJson: text("metadata_json", { mode: "json" }),
    createdAt: timestamps().createdAt
  },
  (table) => ({
    runIdx: index("research_enrichments_run_id_idx").on(table.runId),
    candidateIdx: index("research_enrichments_candidate_id_idx").on(table.candidateId)
  })
);

export const researchScorecards = sqliteTable(
  "research_scorecards",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id").references(() => researchCandidates.id, { onDelete: "cascade" }),
    targetId: text("target_id"),
    icpFit: integer("icp_fit"),
    painEvidence: integer("pain_evidence"),
    reachability: integer("reachability"),
    callLikelihood: integer("call_likelihood"),
    designPartner: integer("design_partner"),
    totalScore: real("total_score"),
    rationale: text("rationale"),
    metadataJson: text("metadata_json", { mode: "json" }),
    createdAt: timestamps().createdAt
  },
  (table) => ({
    runIdx: index("research_scorecards_run_id_idx").on(table.runId),
    candidateIdx: index("research_scorecards_candidate_id_idx").on(table.candidateId)
  })
);

export const researchCheckpoints = sqliteTable(
  "research_checkpoints",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dataJson: text("data_json", { mode: "json" }),
    createdAt: timestamps().createdAt
  },
  (table) => ({ runIdx: index("research_checkpoints_run_id_idx").on(table.runId) })
);

export const targets = sqliteTable(
  "targets",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    listId: text("list_id").references(() => lists.id, { onDelete: "set null" }),
    platform: text("platform", { enum: ["linkedin", "x", "reddit", "discord", "web"] }).notNull(),
    targetType: text("target_type", { enum: ["person", "company", "community", "account", "thread", "page"] }).notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    profileUrl: text("profile_url"),
    organization: text("organization"),
    roleOrContext: text("role_or_context"),
    relevanceScore: real("relevance_score"),
    whyRelevant: text("why_relevant"),
    status: text("status", {
      enum: ["new", "saved", "drafted", "prepared", "sent_by_user", "skipped", "needs_review"]
    }).notNull(),
    metadataJson: text("metadata_json", { mode: "json" }),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt
  },
  (table) => ({
    runIdx: index("targets_run_id_idx").on(table.runId),
    listIdx: index("targets_list_id_idx").on(table.listId),
    platformStatusIdx: index("targets_platform_status_idx").on(table.platform, table.status)
  })
);

export const targetEvidence = sqliteTable(
  "target_evidence",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
    evidenceType: text("evidence_type", {
      enum: ["quote", "observation", "page_fact", "profile_fact", "activity_signal"]
    }).notNull(),
    text: text("text").notNull(),
    url: text("url"),
    confidence: real("confidence"),
    createdAt: timestamps().createdAt
  },
  (table) => ({ targetIdx: index("target_evidence_target_id_idx").on(table.targetId) })
);

export const listItems = sqliteTable(
  "list_items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    targetId: text("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    notes: text("notes"),
    createdAt: timestamps().createdAt
  },
  (table) => ({ listRankIdx: index("list_items_list_id_rank_idx").on(table.listId, table.rank) })
);

export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    platform: text("platform", { enum: ["linkedin", "x", "reddit", "discord", "web"] }).notNull(),
    draftType: text("draft_type", { enum: ["dm", "reply", "connection_note", "comment", "post"] }).notNull(),
    body: text("body").notNull(),
    evidenceSummary: text("evidence_summary"),
    status: text("status", {
      enum: ["generated", "edited", "approved_for_prepare", "prepared", "discarded"]
    }).notNull(),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt
  },
  (table) => ({ targetIdx: index("drafts_target_id_idx").on(table.targetId) })
);

export const outreachActions = sqliteTable(
  "outreach_actions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    targetId: text("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    browserSessionId: text("browser_session_id").references(() => browserSessions.id, { onDelete: "set null" }),
    platform: text("platform", { enum: ["linkedin", "x", "reddit", "discord", "web"] }).notNull(),
    actionType: text("action_type", {
      enum: ["open_profile", "open_composer", "paste_draft", "operator_sent", "submit_post", "submit_comment", "send_private_message", "skipped", "failed"]
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "prepared", "waiting_for_operator", "done", "failed"]
    }).notNull(),
    resultNote: text("result_note"),
    artifactId: text("artifact_id"),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt
  },
  (table) => ({ runIdx: index("outreach_actions_run_id_idx").on(table.runId) })
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["screenshot", "html", "markdown", "csv", "json", "recording", "log", "other"] }).notNull(),
    path: text("path"),
    providerUrl: text("provider_url"),
    title: text("title"),
    metadataJson: text("metadata_json", { mode: "json" }),
    createdAt: timestamps().createdAt
  },
  (table) => ({ runIdx: index("artifacts_run_id_idx").on(table.runId) })
);

export const exportsTable = sqliteTable(
  "exports",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
    listId: text("list_id").references(() => lists.id, { onDelete: "cascade" }),
    format: text("format", { enum: ["markdown", "csv", "json"] }).notNull(),
    artifactId: text("artifact_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
    createdAt: timestamps().createdAt
  },
  (table) => ({
    runIdx: index("exports_run_id_idx").on(table.runId),
    listIdx: index("exports_list_id_idx").on(table.listId)
  })
);
