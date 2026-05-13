-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'resigned');

-- CreateEnum
CREATE TYPE "EmployeeGender" AS ENUM ('male', 'female', 'unset');

-- CreateEnum
CREATE TYPE "EmployeeLeaveType" AS ENUM ('personal', 'sick', 'annual', 'marriage', 'other');

-- CreateEnum
CREATE TYPE "EmployeeShiftType" AS ENUM ('morning', 'nine_to_six', 'middle', 'late', 'full', 'custom');

-- CreateEnum
CREATE TYPE "EmployeePayrollStatus" AS ENUM ('draft', 'confirmed');

-- CreateTable
CREATE TABLE "employee_departments" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_positions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "linked_staff_id" INTEGER,
    "department_id" INTEGER,
    "position_id" INTEGER,
    "emp_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "join_date" TIMESTAMP(3) NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "avatar" TEXT,
    "id_card" TEXT,
    "gender" "EmployeeGender" NOT NULL DEFAULT 'unset',
    "emergency_contact" TEXT,
    "emergency_phone" TEXT,
    "contract_end_date" TIMESTAMP(3),
    "note" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "resign_date" TIMESTAMP(3),
    "resign_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_leaves" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "employee_name" TEXT NOT NULL,
    "type" "EmployeeLeaveType" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "deduct_salary" BOOLEAN NOT NULL,
    "deduct_amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_shifts" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "employee_name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "shift_type" "EmployeeShiftType" NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payrolls" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "employee_name" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "leave_deduction" DECIMAL(12,2) NOT NULL,
    "other_deduction" DECIMAL(12,2) NOT NULL,
    "other_deduction_note" TEXT,
    "bonus" DECIMAL(12,2) NOT NULL,
    "actual_salary" DECIMAL(12,2) NOT NULL,
    "social_insurance" DECIMAL(12,2),
    "housing_fund" DECIMAL(12,2),
    "total_labor_cost" DECIMAL(12,2) NOT NULL,
    "status" "EmployeePayrollStatus" NOT NULL DEFAULT 'draft',
    "confirmed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_departments_store_id_name_key" ON "employee_departments"("store_id", "name");

-- CreateIndex
CREATE INDEX "employee_departments_store_id_updated_at_idx" ON "employee_departments"("store_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "employee_positions_store_id_name_key" ON "employee_positions"("store_id", "name");

-- CreateIndex
CREATE INDEX "employee_positions_store_id_updated_at_idx" ON "employee_positions"("store_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "employees_linked_staff_id_key" ON "employees"("linked_staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_store_id_emp_no_key" ON "employees"("store_id", "emp_no");

-- CreateIndex
CREATE INDEX "employees_store_id_status_updated_at_idx" ON "employees"("store_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "employees_store_id_department_updated_at_idx" ON "employees"("store_id", "department", "updated_at");

-- CreateIndex
CREATE INDEX "employees_store_id_position_updated_at_idx" ON "employees"("store_id", "position", "updated_at");

-- CreateIndex
CREATE INDEX "employees_store_id_join_date_idx" ON "employees"("store_id", "join_date");

-- CreateIndex
CREATE INDEX "employee_leaves_employee_id_start_date_idx" ON "employee_leaves"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "employee_leaves_store_id_start_date_idx" ON "employee_leaves"("store_id", "start_date");

-- CreateIndex
CREATE INDEX "employee_shifts_employee_id_date_idx" ON "employee_shifts"("employee_id", "date");

-- CreateIndex
CREATE INDEX "employee_shifts_store_id_date_idx" ON "employee_shifts"("store_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payrolls_employee_id_month_key" ON "employee_payrolls"("employee_id", "month");

-- CreateIndex
CREATE INDEX "employee_payrolls_store_id_month_idx" ON "employee_payrolls"("store_id", "month");

-- CreateIndex
CREATE INDEX "employee_payrolls_store_id_status_month_idx" ON "employee_payrolls"("store_id", "status", "month");

-- AddForeignKey
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_positions" ADD CONSTRAINT "employee_positions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_linked_staff_id_fkey" FOREIGN KEY ("linked_staff_id") REFERENCES "staffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "employee_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "employee_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payrolls" ADD CONSTRAINT "employee_payrolls_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payrolls" ADD CONSTRAINT "employee_payrolls_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
