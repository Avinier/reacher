import { NextResponse } from "next/server";
import { createRerun } from "@/lib/db/repositories";

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const rerun = createRerun(runId);
  if (!rerun) {
    return new NextResponse("Run not found or cannot be rerun", { status: 404 });
  }
  return NextResponse.json(rerun);
}
