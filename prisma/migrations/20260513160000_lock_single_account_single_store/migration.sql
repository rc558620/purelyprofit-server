DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "stores"
    GROUP BY "owner_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '存在同一账号拥有多个门店的数据，无法添加单账号单门店唯一约束';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "staffs"
    WHERE "user_id" IS NOT NULL
    GROUP BY "user_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '存在同一 user_id 绑定多个门店员工的数据，无法添加唯一约束';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "staffs"
    GROUP BY "email"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '存在同一邮箱绑定多个门店员工的数据，无法添加唯一约束';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "stores" s
    INNER JOIN "users" u ON u."id" = s."owner_id"
    INNER JOIN "staffs" st ON (st."user_id" = u."id" OR st."email" = u."email")
    WHERE st."store_id" <> s."id"
  ) THEN
    RAISE EXCEPTION '存在同一账号跨门店拥有老板/员工关系的数据，无法锁死单门店约束';
  END IF;
END $$;

-- DropIndex
DROP INDEX IF EXISTS "stores_owner_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "staffs_user_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "staffs_store_id_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "stores_owner_id_key" ON "stores"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "staffs_user_id_key" ON "staffs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staffs_email_key" ON "staffs"("email");

CREATE OR REPLACE FUNCTION ensure_single_store_binding_for_store_owner()
RETURNS TRIGGER AS $$
DECLARE
  owner_email TEXT;
BEGIN
  SELECT "email"
  INTO owner_email
  FROM "users"
  WHERE "id" = NEW."owner_id";

  IF EXISTS (
    SELECT 1
    FROM "staffs"
    WHERE "store_id" <> COALESCE(NEW."id", -1)
      AND (
        (NEW."owner_id" IS NOT NULL AND "user_id" = NEW."owner_id")
        OR (owner_email IS NOT NULL AND "email" = owner_email)
      )
  ) THEN
    RAISE EXCEPTION '一个账号只能绑定一个门店，老板账号已关联其他门店';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ensure_single_store_binding_for_staff()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "stores" s
    INNER JOIN "users" u ON u."id" = s."owner_id"
    WHERE s."id" <> NEW."store_id"
      AND (
        (NEW."user_id" IS NOT NULL AND u."id" = NEW."user_id")
        OR u."email" = NEW."email"
      )
  ) THEN
    RAISE EXCEPTION '一个账号只能绑定一个门店，当前员工账号已关联其他门店';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stores_single_store_binding ON "stores";
CREATE TRIGGER trg_stores_single_store_binding
BEFORE INSERT OR UPDATE OF "owner_id"
ON "stores"
FOR EACH ROW
EXECUTE FUNCTION ensure_single_store_binding_for_store_owner();

DROP TRIGGER IF EXISTS trg_staffs_single_store_binding ON "staffs";
CREATE TRIGGER trg_staffs_single_store_binding
BEFORE INSERT OR UPDATE OF "store_id", "user_id", "email"
ON "staffs"
FOR EACH ROW
EXECUTE FUNCTION ensure_single_store_binding_for_staff();
