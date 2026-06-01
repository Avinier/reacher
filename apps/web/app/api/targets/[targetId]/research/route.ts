import { NextResponse } from "next/server";
import { createTargetResearchRun } from "@/lib/db/repositories";

export async function POST(_request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await params;
  const runId = createTargetResearchRun(targetId);
  if (!runId) {
    return new NextResponse("Target not found", { status: 404 });
  }
  return NextResponse.json({ runId });
}
