import { NextRequest, NextResponse } from "next/server";
import { exchangeGmailCode, fetchGoogleUserInfo, gmailOAuthConfig } from "@/lib/gmail/oauth";
import { upsertGmailIntegration } from "@/lib/db/repositories";

function settingsRedirect(request: NextRequest, status: string) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("gmail", status);
  return url;
}

export async function GET(request: NextRequest) {
  const config = gmailOAuthConfig();
  if (!config.ok) {
    return NextResponse.redirect(settingsRedirect(request, "not_configured"));
  }

  const requestUrl = new URL(request.url);
  const error = requestUrl.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(settingsRedirect(request, "denied"));
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const expectedState = request.cookies.get("reacher_gmail_oauth_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(settingsRedirect(request, "invalid_state"));
  }

  try {
    const token = await exchangeGmailCode(config.config, code);
    const user = await fetchGoogleUserInfo(token.access_token);
    upsertGmailIntegration({
      accountLabel: user.name || user.email || "Gmail account",
      accountEmail: user.email ?? null,
      scopes: token.scope ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null
    });
    const response = NextResponse.redirect(settingsRedirect(request, "connected"));
    response.cookies.delete("reacher_gmail_oauth_state");
    return response;
  } catch (oauthError) {
    const url = settingsRedirect(request, "failed");
    url.searchParams.set("reason", oauthError instanceof Error ? oauthError.message.slice(0, 180) : "oauth_failed");
    return NextResponse.redirect(url);
  }
}
