import { NextResponse } from "next/server";
import { z } from "zod";
import { platforms, runKinds } from "@reacher/shared";
import { createRun } from "@/lib/db/repositories";

const createRunSchema = z.object({
  prompt: z.string().min(2),
  kind: z.enum(runKinds).default("research"),
  platforms: z.array(z.enum(platforms)).default(["web"]),
  listId: z.string().optional(),
  targetIds: z.array(z.string()).optional()
});

export async function POST(request: Request) {
  const payload = createRunSchema.parse(await request.json());
  const runId = createRun(payload);
  return NextResponse.json({ runId });
}
