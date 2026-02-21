import { NextRequest, NextResponse } from "next/server";
import { getApexSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runScan } from "@/lib/scanner";
import { createScanEscrow, SCAN_ESCROW_XRP } from "@/lib/xrpl-escrow";
import { getWalletBalance } from "@/lib/xrpl";

const MIN_BALANCE_FOR_ESCROW = 2; // 1 XRP escrow + buffer for fees

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

  const user = await prisma.user.findUnique({
    where: { id: session.dbUserId },
  });
  if (!user?.xrplAddress || !user?.xrplSeed) {
    return NextResponse.json(
      {
        error: "Create a testnet wallet in the Wallet tab first.",
        code: "WALLET_REQUIRED",
      },
      { status: 402 }
    );
  }

  const balance = await getWalletBalance(user.xrplAddress);
  if (balance < MIN_BALANCE_FOR_ESCROW) {
    return NextResponse.json(
      {
        error: `You need at least ${MIN_BALANCE_FOR_ESCROW} XRP to run a scan (1 XRP is held in escrow until the scan completes).`,
        code: "INSUFFICIENT_BALANCE",
      },
      { status: 402 }
    );
  }

  let escrow;
  try {
    escrow = await createScanEscrow(user.xrplSeed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Escrow creation failed";
    return NextResponse.json(
      { error: msg, code: "ESCROW_FAILED" },
      { status: 502 }
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
      escrowOwner: escrow.owner,
      escrowOfferSequence: escrow.offerSequence,
      escrowTxHash: escrow.txHash,
      escrowCancelAfter: escrow.cancelAfterDate,
    },
  });

  runScan(scan.id, session.accessToken).catch((err) => {
    console.error("Scan failed:", err);
    prisma.scan.update({
      where: { id: scan.id },
      data: { status: "failed", errorMessage: err.message },
    }).catch(console.error);
  });

  return NextResponse.json({
    scanId: scan.id,
    status: "pending",
    escrowTxHash: escrow.txHash,
    message: "1 XRP held in escrow; will release to Apex on success or you can cancel after 30 min if the scan fails.",
  });
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
