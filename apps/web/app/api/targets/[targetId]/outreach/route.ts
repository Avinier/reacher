import { NextResponse } from "next/server";
import { setTargetFeedback } from "@/lib/db/repositories";

export async function POST(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { outreached?: unknown; notUseful?: unknown };
  const target = setTargetFeedback(targetId, {
    outreached: typeof payload.outreached === "boolean" ? payload.outreached : undefined,
    notUseful: typeof payload.notUseful === "boolean" ? payload.notUseful : undefined
  });
  if (!target) {
    return new NextResponse("Target not found", { status: 404 });
  }
  return NextResponse.json({ targetId, outreachedAt: target.outreached_at ?? null, notUsefulAt: target.not_useful_at ?? null });
}
