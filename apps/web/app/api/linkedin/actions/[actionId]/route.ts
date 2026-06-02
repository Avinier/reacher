import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, id } from "@/lib/db/client";
import { openLinkedInOutreachSession } from "@/lib/browserbase/server";
import { approveLinkedInAction, recordLinkedInOperatorSent, recordLinkedInStaged } from "@/lib/db/repositories";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), approved: z.boolean() }),
  z.object({ action: z.literal("stage"), approved: z.boolean(), runId: z.string().min(1), profileUrl: z.string().url() }),
  z.object({ action: z.literal("mark_sent") })
]);

export async function POST(request: Request, context: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await context.params;
  const payload = actionSchema.parse(await request.json());

  if (payload.action === "approve") {
    return NextResponse.json(approveLinkedInAction(actionId, payload.approved));
  }

  if (payload.action === "mark_sent") {
    return NextResponse.json(recordLinkedInOperatorSent(actionId));
  }

  if (!payload.approved) {
    return NextResponse.json({ error: "Approve this LinkedIn row before staging it." }, { status: 400 });
  }

  const session = await openLinkedInOutreachSession({ runId: payload.runId, profileUrl: payload.profileUrl });
  const browserSessionId = id("bs");
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO browser_sessions
      (id, run_id, browser_context_id, provider_session_id, status, live_url, started_at, last_url)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(browserSessionId, payload.runId, session.browserContextId, session.providerSessionId, session.liveUrl, now, payload.profileUrl);

  return NextResponse.json(recordLinkedInStaged(actionId, {
    providerSessionId: session.providerSessionId,
    liveUrl: session.liveUrl,
    browserSessionId,
    startUrl: session.startUrl
  }));
}
