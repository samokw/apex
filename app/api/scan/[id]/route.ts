import { NextRequest, NextResponse } from "next/server";
import { getApexSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const scan = await prisma.scan.findUnique({
    where: { id, userId: session.dbUserId },
    include: {
      violations: { orderBy: { score: "desc" } },
      fixes: true,
      pullRequest: true,
    },
  });

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  return NextResponse.json({ scan });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { fixId, status } = await req.json();

  if (!fixId || !["accepted", "rejected", "pending"].includes(status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const scan = await prisma.scan.findUnique({
    where: { id, userId: session.dbUserId },
  });

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  await prisma.fix.update({
    where: { id: fixId, scanId: id },
    data: { status },
  });

  return NextResponse.json({ success: true });
}
