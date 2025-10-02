-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "client_expense_id" TEXT NOT NULL,
    "expense_id" TEXT,
    "storage_provider" TEXT NOT NULL,
    "storage_bucket" TEXT,
    "storage_key" TEXT NOT NULL,
    "storage_url" TEXT,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "checksum" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expenses_report_external_id_key" ON "expenses"("report_id", "external_id");

-- CreateIndex
CREATE INDEX "receipts_report_expense_idx" ON "receipts"("report_id", "client_expense_id");

-- CreateIndex
CREATE INDEX "receipts_expense_id_idx" ON "receipts"("expense_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
