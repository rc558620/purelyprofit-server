-- 将所有 store_id 外键的 ON DELETE 行为从 CASCADE 改为 RESTRICT
-- 防止误删 Store 时级联删除核心业务数据（Member、SaleOrder、FinanceRecord 等）
-- 子实体到子实体的级联（如 Member → MemberPointsLog）保持不变

DO $$
DECLARE
  fk_record RECORD;
  constraint_name text;
  new_constraint_name text;
  table_name text;
  column_name text;
  ref_table text;
  ref_column text;
BEGIN
  FOR fk_record IN
    SELECT
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND kcu.column_name = 'store_id'
      AND ccu.table_name = 'stores'
      AND rc.delete_rule = 'CASCADE'
  LOOP
    constraint_name := fk_record.constraint_name;
    table_name := fk_record.table_name;
    column_name := fk_record.column_name;
    ref_table := fk_record.foreign_table_name;
    ref_column := fk_record.foreign_column_name;

    -- 生成临时约束名（避免重名冲突）
    new_constraint_name := constraint_name || '_tmp';

    RAISE NOTICE 'Replacing FK % on %.%: CASCADE -> RESTRICT', constraint_name, table_name, column_name;

    -- 1. 删除旧约束
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', table_name, constraint_name);

    -- 2. 添加新约束（ON DELETE RESTRICT）
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE RESTRICT ON UPDATE CASCADE',
      table_name, new_constraint_name, column_name, ref_table, ref_column
    );

    -- 3. 将临时约束重命名为原始名称
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', table_name, new_constraint_name, constraint_name);
  END LOOP;
END $$;
