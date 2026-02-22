-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scanId" TEXT,
    "txHash" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XRP',
    "paymentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ledgerIndex" INTEGER,
    "escrowOwner" TEXT,
    "escrowOfferSequence" INTEGER,
    "escrowTxHash" TEXT,
    "escrowCancelAfter" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "createdAt", "currency", "escrowCancelAfter", "escrowOfferSequence", "escrowOwner", "escrowTxHash", "id", "ledgerIndex", "paymentType", "scanId", "status", "txHash", "userId") SELECT "amount", "createdAt", "currency", "escrowCancelAfter", "escrowOfferSequence", "escrowOwner", "escrowTxHash", "id", "ledgerIndex", "paymentType", "scanId", "status", "txHash", "userId" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
