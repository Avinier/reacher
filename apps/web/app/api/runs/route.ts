import { NextResponse } from "next/server";
import { z } from "zod";
import { gmailDraftModes, platforms, runKinds } from "@reacher/shared";
import { createGmailOutreachRun, createRun } from "@/lib/db/repositories";

const createRunSchema = z.object({
  prompt: z.string().min(2),
  kind: z.enum(runKinds).default("research"),
  platforms: z.array(z.enum(platforms)).default(["web"]),
  listId: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
  gmailOutreach: z.object({
    draftMode: z.enum(gmailDraftModes).default("ai"),
    recipientsRaw: z.string().min(1),
    subject: z.string().optional(),
    body: z.string().optional()
  }).optional()
});

export async function POST(request: Request) {
  const payload = createRunSchema.parse(await request.json());
  if (payload.kind === "outreach_prepare" && payload.gmailOutreach) {
    const result = await createGmailOutreachRun({ prompt: payload.prompt, gmailOutreach: payload.gmailOutreach });
    return NextResponse.json(result);
  }
  const runId = createRun(payload);
  return NextResponse.json({ runId });
}
