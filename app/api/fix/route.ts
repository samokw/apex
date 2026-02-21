import { NextRequest, NextResponse } from "next/server";
import { getApexSession } from "@/lib/session";
import { generateFixes } from "@/lib/ai-fixer";

export async function POST(req: NextRequest) {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { scanId } = await req.json();
  if (!scanId) {
    return NextResponse.json({ error: "Missing scanId" }, { status: 400 });
  }

  generateFixes(scanId, session.accessToken).catch((err) => {
    console.error("Fix generation failed:", err);
  });

  return NextResponse.json({ status: "fixing", scanId });
}
