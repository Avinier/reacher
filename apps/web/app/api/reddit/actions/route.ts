import { NextResponse } from "next/server";
import { redditActionTypes, redditRunAsOptions } from "@reacher/shared";
import { z } from "zod";
import { queueRedditWriteAction } from "@/lib/db/repositories";

const actionSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("submit_post"),
    subredditName: z.string().min(1),
    title: z.string().min(1).max(300),
    text: z.string().min(1).max(40000),
    runAs: z.enum(redditRunAsOptions).default("USER"),
    targetId: z.string().optional(),
    draftId: z.string().optional()
  }),
  z.object({
    actionType: z.literal("submit_comment"),
    postId: z.string().min(3),
    text: z.string().min(1).max(10000),
    runAs: z.enum(redditRunAsOptions).default("USER"),
    targetId: z.string().optional(),
    draftId: z.string().optional()
  }),
  z.object({
    actionType: z.literal("send_private_message"),
    username: z.string().min(1).max(80),
    subject: z.string().min(1).max(100),
    text: z.string().min(1).max(10000),
    targetId: z.string().optional(),
    draftId: z.string().optional()
  })
]);

export async function POST(request: Request) {
  const payload = actionSchema.parse(await request.json());
  if (!redditActionTypes.includes(payload.actionType)) {
    return NextResponse.json({ error: "Unsupported Reddit action" }, { status: 400 });
  }
  return NextResponse.json(queueRedditWriteAction(payload));
}
