import { NextResponse } from "next/server";
import { listRecentGmailMessages } from "@/lib/gmail/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10), 1), 25);
  try {
    return NextResponse.json({ messages: await listRecentGmailMessages(limit) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read Gmail messages" },
      { status: 400 }
    );
  }
}
