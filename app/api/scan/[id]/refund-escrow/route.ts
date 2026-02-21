import { NextRequest, NextResponse } from "next/server";
import { getApexSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { cancelEscrow } from "@/lib/xrpl-escrow";

/**
 * Cancel the escrow for a failed scan so the user gets their 1 XRP back.
 * Only allowed when: scan failed, escrow exists, and CancelAfter time has passed.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { id } = await params;

  const scan = await prisma.scan.findUnique({
    where: { id, userId: session.dbUserId },
    include: { user: { select: { xrplSeed: true } } },
  });

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  const ownerSeed = scan.user?.xrplSeed ?? null;
  if (!ownerSeed) {
    return NextResponse.json(
      { error: "Wallet not linked. Link your XRPL wallet in the Wallet tab to refund." },
      { status: 400 }
    );
  }

  if (scan.status !== "failed") {
    return NextResponse.json(
      { error: "Refund is only for failed scans" },
      { status: 400 }
    );
  }

  if (!scan.escrowOwner || scan.escrowOfferSequence == null) {
    return NextResponse.json(
      { error: "No escrow to refund for this scan" },
      { status: 400 }
    );
  }

  if (scan.escrowRefundedAt) {
    return NextResponse.json(
      { error: "Already refunded" },
      { status: 400 }
    );
  }

  const now = new Date();
  const cancelAfter = scan.escrowCancelAfter ? new Date(scan.escrowCancelAfter) : null;
  // Ledger enforces CancelAfter; refund fails with tecNO_PERMISSION if too early
  if (cancelAfter && now < cancelAfter) {
    return NextResponse.json(
      {
        error: `Refund available after ${cancelAfter.toLocaleString()} (5 min from scan start)`,
        cancelAfter: cancelAfter.toISOString(),
      },
      { status: 400 }
    );
  }

  try {
    const { txHash } = await cancelEscrow(scan.escrowOwner, scan.escrowOfferSequence, ownerSeed);
    await prisma.scan.update({
      where: { id },
      data: { escrowRefundedAt: new Date() },
    });
    return NextResponse.json({
      success: true,
      txHash,
      explorerUrl: `https://testnet.xrpl.org/transactions/${txHash}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Refund failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
