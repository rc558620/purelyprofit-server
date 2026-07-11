-- CreateIndex: 员工排班同员工同日唯一约束（BUG-1 DB 级兜底，并发场景拦截同日重复排班）
CREATE UNIQUE INDEX "employee_shifts_employee_id_date_key" ON "employee_shifts"("employee_id", "date");

-- DropIndex: 移除原非唯一索引，避免与唯一约束重复占用
DROP INDEX "employee_shifts_employee_id_date_idx";
