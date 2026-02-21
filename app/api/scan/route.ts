import { NextRequest, NextResponse } from "next/server";
import { getApexSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runScan } from "@/lib/scanner";

export async function POST(req: NextRequest) {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { repoOwner, repoName, branch } = await req.json();

  if (!repoOwner || !repoName) {
    return NextResponse.json(
      { error: "Missing repoOwner or repoName" },
      { status: 400 }
    );
  }

  const scan = await prisma.scan.create({
    data: {
      userId: session.dbUserId,
      repoOwner,
      repoName,
      repoUrl: `https://github.com/${repoOwner}/${repoName}`,
      branch: branch || "main",
      status: "pending",
    },
  });

  // Fire and forget — scan runs asynchronously
  runScan(scan.id, session.accessToken).catch((err) => {
    console.error("Scan failed:", err);
    prisma.scan.update({
      where: { id: scan.id },
      data: { status: "failed", errorMessage: err.message },
    }).catch(console.error);
  });

  return NextResponse.json({ scanId: scan.id, status: "pending" });
}

export async function GET() {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scans = await prisma.scan.findMany({
    where: { userId: session.dbUserId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { violations: true, fixes: true } },
    },
  });

  return NextResponse.json({ scans });
}
