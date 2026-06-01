import { NextResponse } from "next/server";
import { disconnectGmailIntegration } from "@/lib/db/repositories";

export async function POST() {
  disconnectGmailIntegration();
  return NextResponse.json({ disconnected: true });
}
