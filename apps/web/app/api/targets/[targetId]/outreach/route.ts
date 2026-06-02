import { NextResponse } from "next/server";
import { setTargetOutreached } from "@/lib/db/repositories";

export async function POST(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { outreached?: unknown };
  const target = setTargetOutreached(targetId, Boolean(payload.outreached));
  if (!target) {
    return new NextResponse("Target not found", { status: 404 });
  }
  return NextResponse.json({ targetId, outreachedAt: target.outreached_at ?? null });
}
