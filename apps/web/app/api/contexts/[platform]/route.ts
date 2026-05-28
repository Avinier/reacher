import { NextResponse } from "next/server";
import { browserPlatforms, type BrowserPlatform } from "@reacher/shared";
import { getBrowserContext } from "@/lib/db/repositories";
import { openLoginSession, verifyContext } from "@/lib/browserbase/server";

function parsePlatform(platform: string): BrowserPlatform {
  if (!browserPlatforms.includes(platform as BrowserPlatform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return platform as BrowserPlatform;
}

export async function GET(_request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  return NextResponse.json(getBrowserContext(parsePlatform(platform)));
}

export async function POST(request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const action = new URL(request.url).searchParams.get("action") ?? "open";
  const parsed = parsePlatform(platform);

  if (action === "verify") {
    return NextResponse.json(await verifyContext(parsed));
  }

  return NextResponse.json(await openLoginSession(parsed));
}
