import { NextResponse } from "next/server";
import { z } from "zod";
import { createGmailDraft, sendGmailDraft } from "@/lib/gmail/client";
import { approveGmailDraft, recordGmailDraftCreated, recordGmailSent } from "@/lib/db/repositories";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), approved: z.boolean() }),
  z.object({ action: z.literal("create_draft"), to: z.string().email(), subject: z.string().min(1), body: z.string().min(1), approved: z.boolean() }),
  z.object({ action: z.literal("send"), gmailDraftId: z.string().min(1), approved: z.boolean() })
]);

export async function POST(request: Request, context: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await context.params;
  const payload = actionSchema.parse(await request.json());

  if (payload.action === "approve") {
    return NextResponse.json(approveGmailDraft(actionId, payload.approved));
  }

  if (!payload.approved) {
    return NextResponse.json({ error: "Approve this draft before taking Gmail action." }, { status: 400 });
  }

  if (payload.action === "create_draft") {
    const gmailDraft = await createGmailDraft({ to: payload.to, subject: payload.subject, body: payload.body });
    return NextResponse.json(recordGmailDraftCreated(actionId, { gmailDraftId: gmailDraft.draftId, gmailMessageId: gmailDraft.messageId }));
  }

  const sent = await sendGmailDraft(payload.gmailDraftId);
  return NextResponse.json(recordGmailSent(actionId, { gmailMessageId: sent.messageId, gmailThreadId: sent.threadId }));
}
