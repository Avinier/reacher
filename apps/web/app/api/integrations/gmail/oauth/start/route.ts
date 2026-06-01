import { NextResponse } from "next/server";
import { buildGmailAuthUrl, createOAuthState, gmailOAuthConfig } from "@/lib/gmail/oauth";

export async function GET() {
  const config = gmailOAuthConfig();
  if (!config.ok) {
    return NextResponse.json({ error: "Gmail OAuth is not configured", missing: config.missing }, { status: 400 });
  }

  const state = createOAuthState();
  const response = NextResponse.redirect(buildGmailAuthUrl(config.config, state));
  response.cookies.set("reacher_gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 10 * 60
  });
  return response;
}
