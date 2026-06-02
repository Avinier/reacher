import { randomBytes } from "node:crypto";

export const gmailOAuthScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly"
] as const;

export function hasGmailReadScope(scopes: unknown) {
  return String(scopes ?? "").split(/\s+/).includes("https://www.googleapis.com/auth/gmail.readonly");
}

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GmailTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

export type GoogleUserInfo = {
  email?: string;
  name?: string;
  picture?: string;
};

export function gmailOAuthConfig(): { ok: true; config: GmailOAuthConfig } | { ok: false; missing: string[] } {
  const missing = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"].filter(
    (key) => !process.env[key]
  );
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI!
    }
  };
}

export function createOAuthState() {
  return randomBytes(24).toString("base64url");
}

export function buildGmailAuthUrl(config: GmailOAuthConfig, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", gmailOAuthScopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url;
}

export async function exchangeGmailCode(config: GmailOAuthConfig, code: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    })
  });
  const data = (await response.json()) as GmailTokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google token exchange failed");
  }
  return data;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const data = (await response.json()) as GoogleUserInfo & { error?: string; error_description?: string };
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google userinfo lookup failed");
  }
  return data;
}
