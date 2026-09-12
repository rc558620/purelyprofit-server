// 一次性数据修正：为「已注销门店」释放 owner 登录身份，允许手机号重新注册
//
// 背景：
// pulse 管理端注销会员 = store 软删除（stores.deleted_at）。此前注销流程未释放
// 登录身份，导致该手机号无法重新注册：
//   1. staffs 行仍 is_active=true，按 phone + isActive 的登录查找仍命中
//   2. users.email 唯一约束仍被手机号派生登录邮箱（profit_phone_xxx@purelyprofit.local
//      / 旧格式 phone_xxx@purelyprofit.local）占用，注册报「手机号已被注册」
//
// 服务端代码已在 cancelAdminMember 中修复（releaseOwnerLoginIdentity），
// 本脚本仅处理「修复上线前已注销」的存量门店。
//
// 处理内容（与 releaseOwnerLoginIdentity 逻辑一致）：
//   1. 已注销门店的 staffs 行停用，并改写 email/phone/login_account：
//      staffs_email_key 唯一索引与单账号单门店触发器不感知软删除，
//      员工行若仍占用手机号派生邮箱，会阻断同手机号重新注册建店
//      （email 改写为 cancelled_s{storeId}_st{staffId}_{时间戳}@purelyprofit.invalid）
//   2. owner 名下无其他在营门店时：
//      - users.email 改写为 cancelled_u{ownerId}_{时间戳}@purelyprofit.invalid
//        （仅当当前邮箱仍是手机号派生登录邮箱时改写，保证脚本幂等可重复执行）
//      - users.wechat_phone 置空，释放微信授权手机号绑定
//
// 用法：
//   node scripts/release-cancelled-store-login-identity.mjs          # 预览，不落库
//   node scripts/release-cancelled-store-login-identity.mjs --apply  # 事务内执行
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const APPLY = process.argv.includes('--apply');

// 手机号派生的 purely_profit 登录邮箱（含旧格式）；命中才需要释放
const PHONE_DERIVED_EMAIL_PATTERN =
  /^(profit_phone_|phone_)[0-9]+@purelyprofit\.local$/;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. 找出所有已注销门店及其 owner
  const stores = await client.query(
    `SELECT s.id          AS store_id,
            s.name        AS store_name,
            s.owner_id,
            u.email       AS owner_email,
            u.wechat_phone
       FROM stores s
       JOIN users u ON u.id = s.owner_id
      WHERE s.deleted_at IS NOT NULL
      ORDER BY s.id ASC`,
  );

  if (stores.rows.length === 0) {
    console.log('没有已注销门店，无需处理');
    await client.end();
    return;
  }

  // 2. 逐个判断 owner 是否还有其他在营门店、邮箱是否仍是手机号派生登录邮箱
  const pending = [];
  for (const store of stores.rows) {
    const others = await client.query(
      `SELECT count(*)::int AS total
         FROM stores
        WHERE owner_id = $1
          AND deleted_at IS NULL
          AND id <> $2`,
      [store.owner_id, store.store_id],
    );
    const hasOtherActiveStore = others.rows[0].total > 0;
    const needsRelease =
      !hasOtherActiveStore &&
      PHONE_DERIVED_EMAIL_PATTERN.test(store.owner_email ?? '');

    pending.push({ ...store, hasOtherActiveStore, needsRelease });
  }

  const toRelease = pending.filter((row) => row.needsRelease);
  console.log(
    `已注销门店总数: ${pending.length}，owner 身份待释放: ${toRelease.length}`,
  );
  console.table(
    pending.map((row) => ({
      门店ID: row.store_id,
      门店名: row.store_name,
      ownerId: row.owner_id,
      当前邮箱: row.owner_email,
      有其他在营门店: row.hasOtherActiveStore ? '是(跳过)' : '否',
      owner待释放: row.needsRelease ? '是' : '否(已释放或非手机号邮箱)',
    })),
  );

  if (!APPLY) {
    console.log('预览模式（加 --apply 执行修正；脚本幂等，可安全重复执行）');
    await client.end();
    return;
  }

  await client.query('BEGIN');
  try {
    // 第一步：对所有已注销门店释放员工行身份（幂等：cancelled_ 前缀的行自动跳过）
    const staffUpdate = await client.query(
      `UPDATE staffs st
          SET is_active = false,
              email = 'cancelled_s' || st.store_id || '_st' || st.id || '_' || $1 || '@purelyprofit.invalid',
              phone = NULL,
              login_account = NULL
         WHERE st.store_id IN (SELECT id FROM stores WHERE deleted_at IS NOT NULL)
           AND st.email NOT LIKE 'cancelled\\_%'`,
      [String(Date.now())],
    );
    console.log(`员工行身份释放: ${staffUpdate.rowCount} 行`);

    // 第二步：释放 owner 用户身份（仅手机号派生邮箱待释放的）
    for (const row of toRelease) {
      // 释放前再次校验邮箱仍是手机号派生格式，避免并发改写后误伤
      const fresh = await client.query(
        `SELECT email FROM users WHERE id = $1 FOR UPDATE`,
        [row.owner_id],
      );
      if (!PHONE_DERIVED_EMAIL_PATTERN.test(fresh.rows[0]?.email ?? '')) {
        console.log(`跳过 ownerId=${row.owner_id}：邮箱已被处理或格式变化`);
        continue;
      }

      const suffix = `cancelled_u${row.owner_id}_${Date.now()}@purelyprofit.invalid`;
      const userUpdate = await client.query(
        `UPDATE users
            SET email = $2,
                wechat_phone = NULL
          WHERE id = $1`,
        [row.owner_id, suffix],
      );
      console.log(
        `门店 ${row.store_id}（owner ${row.owner_id}）：用户邮箱改写为 ${suffix}（影响 ${userUpdate.rowCount} 行）`,
      );
    }
    await client.query('COMMIT');
    console.log('处理完成');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(String(error).slice(0, 500));
  process.exit(1);
});
