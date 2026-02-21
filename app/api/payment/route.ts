import { NextRequest, NextResponse } from "next/server";
import { getApexSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import {
  fundTestnetWallet,
  submitPayment,
  getWalletBalance,
  getExplorerUrl,
  getPaymentAmount,
} from "@/lib/xrpl";

export async function POST(req: NextRequest) {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, paymentType } = await req.json();

  if (action === "create-wallet") {
    try {
      const wallet = await fundTestnetWallet();
      await prisma.user.update({
        where: { id: session.dbUserId },
        data: {
          xrplAddress: wallet.address,
          xrplSeed: wallet.seed,
        },
      });
      return NextResponse.json({
        address: wallet.address,
        balance: wallet.balance,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Wallet creation failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "get-balance") {
    const user = await prisma.user.findUnique({
      where: { id: session.dbUserId },
    });
    if (!user?.xrplAddress) {
      return NextResponse.json({ balance: 0, address: null });
    }
    const balance = await getWalletBalance(user.xrplAddress);
    return NextResponse.json({ balance, address: user.xrplAddress });
  }

  if (action === "pay") {
    if (!paymentType) {
      return NextResponse.json({ error: "Missing paymentType" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.dbUserId },
    });

    if (!user?.xrplSeed) {
      return NextResponse.json(
        { error: "No wallet configured. Create one first." },
        { status: 400 }
      );
    }

    try {
      const result = await submitPayment(user.xrplSeed, paymentType);

      const payment = await prisma.payment.create({
        data: {
          userId: session.dbUserId,
          txHash: result.txHash,
          amount: result.amount,
          paymentType,
          status: "confirmed",
          ledgerIndex: result.ledgerIndex,
        },
      });

      return NextResponse.json({
        paymentId: payment.id,
        txHash: result.txHash,
        amount: result.amount,
        explorerUrl: getExplorerUrl(result.txHash),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "get-amount") {
    return NextResponse.json({
      amount: getPaymentAmount(paymentType || "scan"),
      currency: "XRP",
    });
  }

  if (action === "can-scan") {
    const user = await prisma.user.findUnique({
      where: { id: session.dbUserId },
    });
    const hasWallet = Boolean(user?.xrplAddress);
    const balance = user?.xrplAddress
      ? await getWalletBalance(user.xrplAddress)
      : 0;
    const minBalanceForEscrow = 2; // 1 XRP escrow + buffer
    const allowed = hasWallet && balance >= minBalanceForEscrow;
    return NextResponse.json({
      allowed,
      hasWallet,
      balance,
      minBalanceForEscrow,
      scanCreditsRemaining: allowed ? null : null, // escrow flow: no "credits", just balance
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
