-- AlterTable
ALTER TABLE "Scan" ADD COLUMN "escrowCancelAfter" DATETIME;
ALTER TABLE "Scan" ADD COLUMN "escrowOfferSequence" INTEGER;
ALTER TABLE "Scan" ADD COLUMN "escrowOwner" TEXT;
ALTER TABLE "Scan" ADD COLUMN "escrowTxHash" TEXT;
