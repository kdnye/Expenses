-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'MANAGER_APPROVED', 'FINANCE_APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalStage" AS ENUM ('MANAGER', 'FINANCE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'FINANCE';

-- AlterTable
ALTER TABLE "reports"
  ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN "manager_email" TEXT;

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateTable
CREATE TABLE "report_approvals" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "stage" "ApprovalStage" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_approvals_report_stage_key" ON "report_approvals"("report_id", "stage");

-- CreateIndex
CREATE INDEX "report_approvals_stage_status_idx" ON "report_approvals"("stage", "status");

-- AddForeignKey
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
