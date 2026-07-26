ALTER TABLE "scan_ordering_spec_groups"
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "scan_ordering_spec_options"
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;
