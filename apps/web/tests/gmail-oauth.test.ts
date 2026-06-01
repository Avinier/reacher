import { afterEach, describe, expect, it } from "vitest";
import { buildGmailAuthUrl, gmailOAuthConfig, gmailOAuthScopes } from "../lib/gmail/oauth";

const keys = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"] as const;

afterEach(() => {
  for (const key of keys) {
    delete process.env[key];
  }
});

describe("Gmail OAuth helpers", () => {
  it("reports missing OAuth env vars", () => {
    const config = gmailOAuthConfig();
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.missing).toEqual([...keys]);
    }
  });

  it("builds a local Gmail consent URL with compose scope and offline access", () => {
    const url = buildGmailAuthUrl(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "http://localhost:3010/api/integrations/gmail/oauth/callback"
      },
      "state-token"
    );

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3010/api/integrations/gmail/oauth/callback");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...gmailOAuthScopes]);
  });
});
