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
import {
  createEscrow,
  finishEscrow,
  cancelEscrow,
  ESCROW_AMOUNTS,
  getEscrowExplorerUrl,
} from "@/lib/xrpl-escrow";

export async function POST(req: NextRequest) {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, paymentType, scanId, paymentId } = await req.json();

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
      console.error("[Wallet] Create error:", err);
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

  // Create an escrow payment for report or pr-credit
  if (action === "create-escrow") {
    if (!paymentType || !scanId) {
      return NextResponse.json(
        { error: "Missing paymentType or scanId" },
        { status: 400 }
      );
    }

    const amount = ESCROW_AMOUNTS[paymentType];
    if (!amount) {
      return NextResponse.json(
        { error: `Unknown payment type: ${paymentType}` },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.dbUserId },
    });

    if (!user?.xrplSeed || !user?.xrplAddress) {
      return NextResponse.json(
        { error: "Create a testnet wallet first.", code: "WALLET_REQUIRED" },
        { status: 402 }
      );
    }

    const minBalance = parseFloat(amount) + 1;
    const balance = await getWalletBalance(user.xrplAddress);
    if (balance < minBalance) {
      return NextResponse.json(
        {
          error: `You need at least ${minBalance} XRP (${amount} XRP escrow + fee buffer).`,
          code: "INSUFFICIENT_BALANCE",
        },
        { status: 402 }
      );
    }

    // Check for existing escrowed payment for this scan+type
    const existing = await prisma.payment.findFirst({
      where: {
        userId: session.dbUserId,
        scanId,
        paymentType,
        status: { in: ["escrowed", "confirmed"] },
      },
    });
    if (existing) {
      return NextResponse.json({
        paymentId: existing.id,
        status: existing.status,
        alreadyPaid: true,
      });
    }

    try {
      const escrow = await createEscrow(user.xrplSeed, amount);

      const payment = await prisma.payment.create({
        data: {
          userId: session.dbUserId,
          scanId,
          amount,
          paymentType,
          status: "escrowed",
          escrowOwner: escrow.owner,
          escrowOfferSequence: escrow.offerSequence,
          escrowTxHash: escrow.txHash,
          escrowCancelAfter: escrow.cancelAfterDate,
        },
      });

      return NextResponse.json({
        paymentId: payment.id,
        escrowTxHash: escrow.txHash,
        explorerUrl: getEscrowExplorerUrl(escrow.txHash),
        cancelAfter: escrow.cancelAfterDate.toISOString(),
        amount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Escrow creation failed";
      return NextResponse.json({ error: msg, code: "ESCROW_FAILED" }, { status: 502 });
    }
  }

  // Finish an escrow (release XRP to Apex) — called on successful operation
  if (action === "finish-escrow") {
    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.userId !== session.dbUserId) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    if (payment.status !== "escrowed") {
      return NextResponse.json({ status: payment.status, alreadyProcessed: true });
    }
    if (!payment.escrowOwner || payment.escrowOfferSequence == null) {
      return NextResponse.json({ error: "No escrow data on payment" }, { status: 400 });
    }

    try {
      const result = await finishEscrow(payment.escrowOwner, payment.escrowOfferSequence);
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "confirmed", txHash: result.txHash },
      });
      return NextResponse.json({ status: "confirmed", txHash: result.txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Escrow finish failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Cancel an escrow (return XRP to user) — available after cancelAfter time
  if (action === "cancel-escrow") {
    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.userId !== session.dbUserId) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    if (payment.status !== "escrowed") {
      return NextResponse.json({ error: "Escrow is not active", status: payment.status }, { status: 400 });
    }
    if (!payment.escrowOwner || payment.escrowOfferSequence == null) {
      return NextResponse.json({ error: "No escrow data" }, { status: 400 });
    }

    if (payment.escrowCancelAfter && new Date() < payment.escrowCancelAfter) {
      const waitSec = Math.ceil((payment.escrowCancelAfter.getTime() - Date.now()) / 1000);
      return NextResponse.json(
        { error: `Cannot cancel yet. Wait ${waitSec}s.`, canCancelAt: payment.escrowCancelAfter.toISOString() },
        { status: 425 }
      );
    }

    try {
      const result = await cancelEscrow(payment.escrowOwner, payment.escrowOfferSequence);
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "cancelled", txHash: result.txHash },
      });
      return NextResponse.json({ status: "cancelled", txHash: result.txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Escrow cancel failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Check if a payment exists for a scan+type
  if (action === "check-payment") {
    if (!paymentType || !scanId) {
      return NextResponse.json({ error: "Missing paymentType or scanId" }, { status: 400 });
    }

    const payment = await prisma.payment.findFirst({
      where: {
        userId: session.dbUserId,
        scanId,
        paymentType,
        status: { in: ["escrowed", "confirmed"] },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      paid: !!payment,
      payment: payment
        ? {
            id: payment.id,
            status: payment.status,
            escrowTxHash: payment.escrowTxHash,
            escrowCancelAfter: payment.escrowCancelAfter?.toISOString(),
          }
        : null,
    });
  }

  if (action === "get-amount") {
    const amount = ESCROW_AMOUNTS[paymentType] || getPaymentAmount(paymentType || "scan");
    return NextResponse.json({ amount, currency: "XRP" });
  }

  if (action === "can-scan") {
    const user = await prisma.user.findUnique({
      where: { id: session.dbUserId },
    });
    const hasWallet = Boolean(user?.xrplAddress);
    const balance = user?.xrplAddress
      ? await getWalletBalance(user.xrplAddress)
      : 0;
    const minBalanceForEscrow = 2;
    const allowed = hasWallet && balance >= minBalanceForEscrow;
    return NextResponse.json({
      allowed,
      hasWallet,
      balance,
      minBalanceForEscrow,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
