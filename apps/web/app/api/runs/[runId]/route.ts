import { NextResponse } from "next/server";
import { deleteRun } from "@/lib/db/repositories";

export async function DELETE(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const deleted = deleteRun(runId);
  return NextResponse.json({ deleted });
}
