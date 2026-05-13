-- CreateIndex
CREATE INDEX "stores_owner_id_updated_at_idx" ON "stores"("owner_id", "updated_at");

-- CreateIndex
CREATE INDEX "staffs_store_id_updated_at_idx" ON "staffs"("store_id", "updated_at");

-- CreateIndex
CREATE INDEX "staffs_store_id_status_is_seat_active_is_active_idx"
ON "staffs"("store_id", "status", "is_seat_active", "is_active");

-- CreateIndex
CREATE INDEX "staffs_user_id_status_is_active_idx"
ON "staffs"("user_id", "status", "is_active");

-- CreateIndex
CREATE INDEX "staffs_email_status_is_active_idx"
ON "staffs"("email", "status", "is_active");
