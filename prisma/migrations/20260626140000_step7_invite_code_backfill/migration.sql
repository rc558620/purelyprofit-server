-- Step 7: 为所有现有门店回填持久化邀请码
--
-- 字符集：23456789ABCDEFGHJKLMNPQRSTUVWXYZ（去除易混淆字符 0/O/I/1）
-- 长度：8 位
-- 生成算法：基于 gen_random_uuid() 的 UUID 字节做字符集映射
-- 碰撞处理：使用 ON CONFLICT DO NOTHING + 循环重试（单次回填无需担心碰撞）
--
-- 前置条件：store_invite_codes 表已存在（由 20260625170000 迁移创建）

DO $$
DECLARE
  charset CONSTANT text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  charset_len CONSTANT int := 32;
  code_len CONSTANT int := 8;
  v_store_id int;
  v_code text;
  v_byte int;
  v_i int;
  v_attempt int;
  max_attempts CONSTANT int := 20;
  inserted BOOLEAN;
BEGIN
  -- 为每个还没有邀请码的门店生成一个
  FOR v_store_id IN
    SELECT s.id
    FROM stores s
    WHERE NOT EXISTS (
      SELECT 1 FROM store_invite_codes sic WHERE sic.store_id = s.id
    )
    ORDER BY s.id
  LOOP
    inserted := FALSE;
    v_attempt := 0;

    WHILE NOT inserted AND v_attempt < max_attempts LOOP
      -- 生成 8 位邀请码（从 UUID v4 字节映射）
      v_code := '';
      FOR v_i IN 1..code_len LOOP
        v_byte := get_byte(gen_random_bytes(1), 0) % charset_len;
        v_code := v_code || substr(charset, v_byte + 1, 1);
      END LOOP;

      -- 插入（唯一约束冲突时跳过）
      BEGIN
        INSERT INTO store_invite_codes (store_id, code, is_active, used_count, created_at, updated_at)
        VALUES (v_store_id, v_code, TRUE, 0, NOW(), NOW());
        inserted := TRUE;
      EXCEPTION WHEN unique_violation THEN
        -- 碰撞，重试
        v_attempt := v_attempt + 1;
      END;
    END LOOP;

    IF NOT inserted THEN
      RAISE WARNING 'Failed to generate unique invite code for store % after % attempts', v_store_id, max_attempts;
    END IF;
  END LOOP;

  RAISE NOTICE 'Invite code backfill completed for stores without existing codes';
END;
$$;
