import { Wallet, xrpToDrops } from "xrpl";
import { getXrplClient, getExplorerUrl } from "./xrpl";

const RIPPLE_EPOCH_SECONDS = 946684800; // Jan 1, 2000 00:00:00 UTC
const FINISH_AFTER_SECONDS = 45; // ~45 sec — Apex can release after this
const CANCEL_AFTER_SECONDS = 300; // 5 min — user can cancel and reclaim XRP

export const ESCROW_AMOUNTS: Record<string, string> = {
  scan: "1",
  report: "0.5",
  "pr-credit": "2",
};

const APEX_WALLET_SEED =
  process.env.XRPL_WALLET_SEED || process.env.APEX_XRPL_SEED;

function rippleTimeNow(): number {
  return Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_SECONDS;
}

export interface EscrowResult {
  txHash: string;
  offerSequence: number;
  owner: string;
  cancelAfterRipple: number;
  cancelAfterDate: Date;
}

/**
 * Lock XRP in escrow from user to Apex.
 * On success we finish (release to Apex); on failure user can cancel after 5 min.
 */
export async function createEscrow(
  userSeed: string,
  amountXRP: string
): Promise<EscrowResult> {
  if (!APEX_WALLET_SEED) {
    throw new Error(
      "Receiving wallet not configured. Set XRPL_WALLET_SEED or APEX_XRPL_SEED."
    );
  }
  const client = await getXrplClient();
  try {
    const userWallet = Wallet.fromSeed(userSeed);
    const apexWallet = Wallet.fromSeed(APEX_WALLET_SEED);
    const now = rippleTimeNow();
    const finishAfter = now + FINISH_AFTER_SECONDS;
    const cancelAfter = now + CANCEL_AFTER_SECONDS;

    const escrowCreate = {
      TransactionType: "EscrowCreate",
      Account: userWallet.address,
      Amount: xrpToDrops(amountXRP),
      Destination: apexWallet.address,
      FinishAfter: finishAfter,
      CancelAfter: cancelAfter,
    };

    const prepared = await client.autofill(escrowCreate as never);
    const offerSequence = (prepared as { Sequence: number }).Sequence;
    const signed = userWallet.sign(prepared as never);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as { TransactionResult?: string })
      ?.TransactionResult;
    if (txResult !== "tesSUCCESS") {
      throw new Error(`EscrowCreate failed: ${txResult}`);
    }

    const cancelAfterDate = new Date(
      (RIPPLE_EPOCH_SECONDS + cancelAfter) * 1000
    );

    return {
      txHash: result.result.hash as string,
      offerSequence,
      owner: userWallet.address,
      cancelAfterRipple: cancelAfter,
      cancelAfterDate,
    };
  } finally {
    await client.disconnect();
  }
}

/** Backwards-compatible wrapper for scan escrows */
export async function createScanEscrow(
  userSeed: string
): Promise<EscrowResult> {
  return createEscrow(userSeed, ESCROW_AMOUNTS.scan);
}

/**
 * Release escrowed 1 XRP to Apex (call when scan succeeds). Any account may submit; we use Apex to pay the fee.
 */
export async function finishEscrow(
  owner: string,
  offerSequence: number
): Promise<{ txHash: string }> {
  if (!APEX_WALLET_SEED) {
    throw new Error("APEX_XRPL_SEED / XRPL_WALLET_SEED not configured");
  }
  const client = await getXrplClient();
  try {
    const apexWallet = Wallet.fromSeed(APEX_WALLET_SEED);
    const escrowFinish = {
      TransactionType: "EscrowFinish",
      Account: apexWallet.address,
      Owner: owner,
      OfferSequence: offerSequence,
    };
    const prepared = await client.autofill(escrowFinish as never);
    const signed = apexWallet.sign(prepared as never);
    const result = await client.submitAndWait(signed.tx_blob);
    const txResult = (result.result.meta as { TransactionResult?: string })
      ?.TransactionResult;
    if (txResult !== "tesSUCCESS") {
      throw new Error(`EscrowFinish failed: ${txResult}`);
    }
    return { txHash: result.result.hash as string };
  } finally {
    await client.disconnect();
  }
}

/**
 * Return escrowed XRP to the owner (call when scan failed and CancelAfter has passed). Any account may submit.
 */
export async function cancelEscrow(
  owner: string,
  offerSequence: number
): Promise<{ txHash: string }> {
  if (!APEX_WALLET_SEED) {
    throw new Error("APEX_XRPL_SEED / XRPL_WALLET_SEED not configured");
  }
  const client = await getXrplClient();
  try {
    const apexWallet = Wallet.fromSeed(APEX_WALLET_SEED);
    const escrowCancel = {
      TransactionType: "EscrowCancel",
      Account: apexWallet.address,
      Owner: owner,
      OfferSequence: offerSequence,
    };
    const prepared = await client.autofill(escrowCancel as never);
    const signed = apexWallet.sign(prepared as never);
    const result = await client.submitAndWait(signed.tx_blob);
    const txResult = (result.result.meta as { TransactionResult?: string })
      ?.TransactionResult;
    if (txResult !== "tesSUCCESS") {
      throw new Error(`EscrowCancel failed: ${txResult}`);
    }
    return { txHash: result.result.hash as string };
  } finally {
    await client.disconnect();
  }
}

export function getEscrowExplorerUrl(txHash: string): string {
  return getExplorerUrl(txHash);
}

export const SCAN_ESCROW_XRP = ESCROW_AMOUNTS.scan;
