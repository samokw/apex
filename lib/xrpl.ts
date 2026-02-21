import { Client, Wallet, Payment, xrpToDrops } from "xrpl";

const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";

const PAYMENT_AMOUNTS: Record<string, string> = {
  scan: "1",
  report: "0.5",
  "pr-credit": "2",
};

const APEX_WALLET_SEED = process.env.APEX_XRPL_SEED;

export async function getXrplClient() {
  const client = new Client(TESTNET_URL);
  await client.connect();
  return client;
}

export async function fundTestnetWallet() {
  const client = await getXrplClient();
  try {
    const { wallet, balance } = await client.fundWallet();
    return {
      address: wallet.address,
      seed: wallet.seed!,
      balance: Number(balance),
    };
  } finally {
    await client.disconnect();
  }
}

export async function getWalletBalance(address: string): Promise<number> {
  const client = await getXrplClient();
  try {
    const response = await client.getXrpBalance(address);
    return Number(response);
  } catch {
    return 0;
  } finally {
    await client.disconnect();
  }
}

export async function submitPayment(
  senderSeed: string,
  paymentType: string
): Promise<{
  txHash: string;
  ledgerIndex: number;
  amount: string;
}> {
  const amount = PAYMENT_AMOUNTS[paymentType];
  if (!amount) throw new Error(`Unknown payment type: ${paymentType}`);

  if (!APEX_WALLET_SEED) throw new Error("APEX_XRPL_SEED not configured");

  const client = await getXrplClient();
  try {
    const senderWallet = Wallet.fromSeed(senderSeed);
    const receiverWallet = Wallet.fromSeed(APEX_WALLET_SEED);

    const payment: Payment = {
      TransactionType: "Payment",
      Account: senderWallet.address,
      Amount: xrpToDrops(amount),
      Destination: receiverWallet.address,
    };

    const prepared = await client.autofill(payment);
    const signed = senderWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const meta = result.result.meta;
    const txResult =
      typeof meta === "object" && meta !== null && "TransactionResult" in meta
        ? (meta as { TransactionResult: string }).TransactionResult
        : "unknown";

    if (txResult !== "tesSUCCESS") {
      throw new Error(`Transaction failed: ${txResult}`);
    }

    return {
      txHash: result.result.hash,
      ledgerIndex: result.result.ledger_index ?? 0,
      amount,
    };
  } finally {
    await client.disconnect();
  }
}

export function getExplorerUrl(txHash: string): string {
  return `https://testnet.xrpl.org/transactions/${txHash}`;
}

export function getPaymentAmount(paymentType: string): string {
  return PAYMENT_AMOUNTS[paymentType] ?? "0";
}
