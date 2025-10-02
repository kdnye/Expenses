-- CreateTable
CREATE TABLE "reports" (
    "report_id" TEXT NOT NULL,
    "employee_email" TEXT NOT NULL,
    "finalized_at" TIMESTAMP(3) NOT NULL,
    "finalized_year" INTEGER NOT NULL,
    "finalized_month" INTEGER NOT NULL,
    "finalized_week" INTEGER NOT NULL,
    "header" JSONB,
    "totals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "external_id" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "incurred_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_employee_email_finalized_at_idx" ON "reports"("employee_email", "finalized_at");

-- CreateIndex
CREATE INDEX "reports_period_idx" ON "reports"("finalized_year", "finalized_month", "finalized_week");

-- CreateIndex
CREATE INDEX "expenses_report_id_idx" ON "expenses"("report_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
