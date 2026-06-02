import { getGmailIntegration, upsertGmailIntegration } from "@/lib/db/repositories";
import { gmailOAuthConfig } from "./oauth";

type TokenRefreshResponse = {
  access_token: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function base64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeHeader(value: string) {
  return /[^\x20-\x7E]/.test(value) ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=` : value;
}

function mimeMessage(input: { to: string; from?: string; subject: string; body: string }) {
  return [
    input.from ? `From: ${input.from}` : "",
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.body
  ].filter((line, index) => index > 4 || line.length > 0).join("\r\n");
}

async function refreshAccessToken(refreshToken: string) {
  const config = gmailOAuthConfig();
  if (!config.ok) throw new Error(`Gmail OAuth is not configured: ${config.missing.join(", ")}`);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.config.clientId,
      client_secret: config.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const data = (await response.json()) as TokenRefreshResponse;
  if (!response.ok) throw new Error(data.error_description || data.error || "Could not refresh Gmail token");
  return data;
}

export async function gmailAccessToken() {
  const integration = getGmailIntegration();
  if (!integration?.refresh_token) throw new Error("Connect Gmail before creating or sending drafts.");
  const expiresAt = Number(integration.expires_at ?? 0);
  const currentToken = String(integration.access_token ?? "");
  if (currentToken && expiresAt > Date.now() + 60_000) return currentToken;
  const refreshed = await refreshAccessToken(String(integration.refresh_token));
  upsertGmailIntegration({
    accountLabel: String(integration.account_label ?? ""),
    accountEmail: String(integration.account_email ?? ""),
    scopes: refreshed.scope ?? String(integration.scopes ?? ""),
    accessToken: refreshed.access_token,
    refreshToken: String(integration.refresh_token),
    expiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : null
  });
  return refreshed.access_token;
}

export async function createGmailDraft(input: { to: string; subject: string; body: string }) {
  const token = await gmailAccessToken();
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ message: { raw: base64Url(mimeMessage(input)) } })
  });
  const data = (await response.json()) as { id?: string; message?: { id?: string }; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "Gmail draft creation failed");
  return { draftId: data.id, messageId: data.message?.id };
}

export async function sendGmailDraft(gmailDraftId: string) {
  const token = await gmailAccessToken();
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(gmailDraftId)}/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    }
  });
  const data = (await response.json()) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "Gmail draft send failed");
  return { messageId: data.id, threadId: data.threadId };
}

function headerValue(payload: { headers?: { name?: string; value?: string }[] } | undefined, name: string) {
  return payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export type GmailMessageSummary = {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

export async function listRecentGmailMessages(maxResults = 10): Promise<GmailMessageSummary[]> {
  const token = await gmailAccessToken();
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set("q", "newer_than:30d");
  const listResponse = await fetch(listUrl, {
    headers: { authorization: `Bearer ${token}` }
  });
  const listData = (await listResponse.json()) as { messages?: { id: string; threadId?: string }[]; error?: { message?: string } };
  if (!listResponse.ok) throw new Error(listData.error?.message || "Gmail message list failed");

  const messages = await Promise.all(
    (listData.messages || []).slice(0, maxResults).map(async (message) => {
      const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}`);
      detailUrl.searchParams.set("format", "metadata");
      detailUrl.searchParams.append("metadataHeaders", "From");
      detailUrl.searchParams.append("metadataHeaders", "Subject");
      detailUrl.searchParams.append("metadataHeaders", "Date");
      const detailResponse = await fetch(detailUrl, {
        headers: { authorization: `Bearer ${token}` }
      });
      const detail = (await detailResponse.json()) as {
        id: string;
        threadId?: string;
        snippet?: string;
        payload?: { headers?: { name?: string; value?: string }[] };
        error?: { message?: string };
      };
      if (!detailResponse.ok) throw new Error(detail.error?.message || "Gmail message lookup failed");
      return {
        id: detail.id,
        threadId: detail.threadId,
        from: headerValue(detail.payload, "From"),
        subject: headerValue(detail.payload, "Subject"),
        date: headerValue(detail.payload, "Date"),
        snippet: detail.snippet || ""
      };
    })
  );

  return messages;
}
