export const platforms = ["web", "linkedin", "x", "reddit", "discord", "github", "email"] as const;
export const browserPlatforms = ["linkedin", "x", "reddit", "discord"] as const;
export const runKinds = ["research", "outreach_prepare", "reddit_write", "export", "context_verify"] as const;
export const runStatuses = [
  "queued",
  "claimed",
  "running",
  "waiting_for_context",
  "waiting_for_operator",
  "completed",
  "failed",
  "cancelled",
  "interrupted"
] as const;
export const contextStatuses = ["needs_login", "ready", "expired", "locked", "error"] as const;
export const exportFormats = ["markdown", "csv", "json"] as const;

export type Platform = (typeof platforms)[number];
export type BrowserPlatform = (typeof browserPlatforms)[number];
export type RunKind = (typeof runKinds)[number];
export type RunStatus = (typeof runStatuses)[number];
export type ContextStatus = (typeof contextStatuses)[number];
export type ExportFormat = (typeof exportFormats)[number];

export type RunSettings = {
  platforms: Platform[];
  listId?: string;
  targetIds?: string[];
  includeDrafts?: boolean;
  gmailOutreach?: GmailOutreachPayload;
  linkedinOutreach?: LinkedInOutreachPayload;
};

export type ExportPayload = {
  generated_at: string;
  prompt: string;
  interpreted_goal: string | null;
  filters: unknown[];
  sources: unknown[];
  targets: unknown[];
  drafts: unknown[];
};

export const redditActionTypes = ["submit_post", "submit_comment", "send_private_message"] as const;
export const redditRunAsOptions = ["USER", "APP"] as const;

export type RedditActionType = (typeof redditActionTypes)[number];
export type RedditRunAs = (typeof redditRunAsOptions)[number];

export type RedditWritePayload = {
  actionType: RedditActionType;
  runAs?: RedditRunAs;
  subredditName?: string;
  postId?: string;
  username?: string;
  subject?: string;
  title?: string;
  text: string;
  targetId?: string;
  draftId?: string;
};

export const gmailDraftModes = ["ai", "template"] as const;

export type GmailDraftMode = (typeof gmailDraftModes)[number];

export type GmailRecipient = {
  email: string;
  name?: string;
  company?: string;
  role?: string;
  notes?: string;
};

export type GmailOutreachPayload = {
  draftMode: GmailDraftMode;
  recipientsRaw: string;
  subject?: string;
  body?: string;
};

export type LinkedInOutreachPayload = {
  targetIds?: string[];
  listIds?: string[];
  connectionTemplate: string;
  dmTemplate: string;
  mode: "connect_note_first";
};
