# XRP Ledger Hackathon — Implementation Plan

**Prize criteria:** Build an MVP that leverages the XRP Ledger’s **core features** to solve a **real-world problem**. Interest in DeFi, privacy, and **programmability**.

**Apex’s angle:** Use XRPL for **pay-per-scan accessibility audits** (real-world: AODA/WCAG compliance) and add **on-chain proof** (programmability).

---

## 1. Must-have: Make XRP Actually Gate the Product

Right now scans run without payment. For the MVP to “leverage XRPL,” payment must control access.

| Task | What to do |
|------|------------|
| **Gate scan on payment** | In `app/api/scan/route.ts` (POST): before creating a scan, require the user to have a wallet and either (A) a recent `Payment` of type `scan` for this “credit,” or (B) sufficient XRP balance and deduct (or escrow) on scan start. Option A is simpler: e.g. “user must have at least one confirmed `scan` payment” or “deduct one scan credit when starting a scan” (and ensure they paid for that credit via XRP). |
| **Gate report on payment** | In the route that serves or generates the report (e.g. report page or API), require a `report` payment (or report credit) before allowing download/generation. |
| **Gate PR on payment** | In `app/api/pr/route.ts`, require a `pr-credit` payment before creating the PR. |
| **UI clarity** | On Repos tab: if user has no wallet or no scan credit, show “Create wallet & pay for a scan” (link to Wallet) instead of allowing Scan. After payment, they can scan. |

**Outcome:** “Pay with XRP → get scan/report/PR.” Clear story for judges.

---

## 2. Leverage More XRPL Core Features (Programmability / Innovation)

Using only “send XRP” is minimal. Adding one or two of these will align with **programmability** and **core features**.

### A. **Escrow (pay for outcome)**

- **Idea:** User locks 1 XRP in **XRPL Escrow** when starting a scan. On **success**: release to Apex. On **failure**: return to user.
- **Why it fits:** Uses XRPL Escrow; payment is tied to outcome (trustless).
- **Implementation:** Add `lib/xrpl-escrow.ts`: create escrow (FinishAfter or CancelAfter), finish escrow (Apex completes scan, backend finishes), cancel (return funds on failure). Scan API: create escrow → start scan; on completion/failure call finish or cancel.

### B. **NFT certificate (programmability)**

- **Idea:** When a scan completes (or user pays for “Report”), **mint an XRPL NFT** (XLS-20) that represents the compliance result (e.g. metadata: score, date, repo name, report URL).
- **Why it fits:** Programmability; real-world artifact (verifiable credential / proof of compliance).
- **Implementation:** Use XRPL NFT (NFTokenMint). Store NFT ID in DB (e.g. on `Scan` or new `ComplianceCertificate`). Display “View certificate on XRPL” on scan/report page.

### C. **Issued currency (DeFi-flavored)**

- **Idea:** Apex issues a token (e.g. “APEX” or “SCAN”) on XRPL. Users buy/hold token and spend it for scans (or use XRP + token).
- **Why it fits:** Uses Issued Currencies; simple token economy.
- **Implementation:** Trust line + payment in issued currency; or keep XRP-only for MVP and document “Issued token” as a roadmap item.

**Recommendation:** Implement **1 + (A or B)**. 1 is required; Escrow or NFT certificate makes the submission stand out.

---

## 3. Real-World Problem & Pitch

- **Problem:** Accessibility compliance (AODA, WCAG) is mandatory for many organizations; audits are manual and costly.
- **Solution:** Pay-per-scan with XRP (no credit card), automated audits, optional **on-chain proof** (Escrow = pay for outcome; NFT = verifiable certificate).
- **XRPL core features used:** Native XRP payments, (optional) Escrow, (optional) NFTs (XLS-20).

---

## 4. Submission Checklist

- [ ] **Payment enforced** for scan (and optionally report / PR).
- [ ] **Wallet flow** is smooth on testnet: create wallet → get test XRP → pay for scan → scan runs.
- [ ] At least one **additional XRPL feature** (Escrow or NFT certificate) implemented and working on testnet.
- [ ] **README or submission doc** states: problem, solution, which XRPL features, and how to run the demo.
- [ ] **Demo video** (optional but strong): create wallet → fund → pay → run scan → show Escrow or NFT certificate.

---

## 5. Quick Code Hooks

| Where | What to add |
|-------|-------------|
| `app/api/scan/route.ts` (POST) | After auth, check user has wallet + scan credit (e.g. `Payment` with `paymentType: 'scan'` and `status: 'confirmed'`). If not, return 402 with message to create wallet / pay. Optionally “consume” a credit (e.g. link payment to scan or decrement a credit). |
| `app/api/payment/route.ts` | Already creates `Payment` on “pay”; ensure `paymentType` and `status: 'confirmed'` are set so scan route can check. |
| `app/dashboard/repos/page.tsx` | Before starting scan: call an endpoint like `GET /api/payment?action=can-scan` that returns `{ allowed: boolean, reason?: string }`; if not allowed, show message and link to Wallet. |
| Escrow | New `lib/xrpl-escrow.ts` + call from scan flow (create on start, finish/cancel on complete/fail). |
| NFT | New `lib/xrpl-nft.ts` (NFTokenMint) + call when scan completes or report is paid; store NFT ID on `Scan` or new model. |

Once payment is enforced and one of Escrow or NFT is in place, the project clearly “leverages XRPL’s core features” and fits the hackathon criteria.
