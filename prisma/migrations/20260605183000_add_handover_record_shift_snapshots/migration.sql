ALTER TABLE "store_handover_records"
  ADD COLUMN "employee_shift_id_snapshot" INTEGER,
  ADD COLUMN "from_employee_name_snapshot" TEXT,
  ADD COLUMN "shift_type_snapshot" "EmployeeShiftType",
  ADD COLUMN "shift_name_snapshot" TEXT,
  ADD COLUMN "shift_start_time_snapshot" TEXT,
  ADD COLUMN "shift_end_time_snapshot" TEXT;
