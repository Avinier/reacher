import type { LinkedInOutreachPayload } from "@reacher/shared";

export type LinkedInTemplateTarget = {
  id: string;
  displayName: string;
  company?: string;
  role?: string;
  headline?: string;
  notes?: string;
  linkedInUrl?: string;
};

function value(target: LinkedInTemplateTarget, key: string) {
  switch (key.toLowerCase()) {
    case "name":
      return target.displayName;
    case "company":
      return target.company || "";
    case "role":
      return target.role || "";
    case "headline":
      return target.headline || "";
    case "notes":
      return target.notes || "";
    case "linkedin_url":
      return target.linkedInUrl || "";
    default:
      return "";
  }
}

export function renderLinkedInTemplate(template: string, target: LinkedInTemplateTarget) {
  return template.replace(/\{\{\s*(name|company|role|headline|notes|linkedin_url)\s*\}\}/gi, (_match, key: string) => value(target, key));
}

function ruleSnippet(target: LinkedInTemplateTarget) {
  if (target.notes) return `Noticed ${target.notes}`;
  if (target.company && target.role) return `Saw your work as ${target.role} at ${target.company}`;
  if (target.company) return `Saw what you're building at ${target.company}`;
  if (target.role) return `Saw your work around ${target.role}`;
  return "Wanted to connect after coming across your profile";
}

function normalizeWhitespace(text: string) {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function truncateConnectionNote(text: string) {
  const clean = normalizeWhitespace(text).replace(/\s*\n\s*/g, " ");
  return clean.length <= 280 ? clean : `${clean.slice(0, 277).trimEnd()}...`;
}

export function linkedInDraftsForTarget(payload: LinkedInOutreachPayload, target: LinkedInTemplateTarget) {
  const snippet = ruleSnippet(target);
  const withSnippet = { ...target, notes: target.notes || snippet };
  const connectionNote = truncateConnectionNote(renderLinkedInTemplate(payload.connectionTemplate, withSnippet) || `Hi ${target.displayName}, ${snippet}. Would be good to connect.`);
  const dm = normalizeWhitespace(renderLinkedInTemplate(payload.dmTemplate, withSnippet) || `Hi ${target.displayName},\n\n${snippet}. Would be useful to compare notes.\n\nBest,`);
  return { connectionNote, dm, snippet };
}

export function hasLinkedInUrl(url: unknown) {
  return /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(String(url || ""));
}
