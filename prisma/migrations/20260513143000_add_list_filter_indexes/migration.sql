-- CreateIndex
CREATE INDEX "stores_name_idx" ON "stores"("name");

-- CreateIndex
CREATE INDEX "stores_contact_name_idx" ON "stores"("contact_name");

-- CreateIndex
CREATE INDEX "staffs_store_id_status_role_updated_at_idx"
ON "staffs"("store_id", "status", "role", "updated_at");
