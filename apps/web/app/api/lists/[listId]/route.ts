import { NextResponse } from "next/server";
import { deleteList } from "@/lib/db/repositories";

export async function DELETE(_request: Request, { params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  const deleted = deleteList(listId);
  return NextResponse.json({ deleted });
}
