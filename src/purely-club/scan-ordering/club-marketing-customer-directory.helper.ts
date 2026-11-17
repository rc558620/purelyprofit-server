import { Prisma } from '@prisma/client';

/** 顾客档案定位结果（只读路径可能为 null）。 */
export interface ClubActiveMarketingCustomer {
  id: number;
  balance: number;
  phone: string | null;
}

/** 顾客档案定位共用投影：调用方只需要 id / 余额 / 手机号三列。 */
export const ACTIVE_CUSTOMER_SELECT =
  Prisma.validator<Prisma.MarketingCustomerSelect>()({
    id: true,
    balance: true,
    phone: true,
  });

/** 建档所需的账号基础信息 */
export type ClubCustomerDirectoryUser = {
  name: string | null;
  wechatPhone: string | null;
} | null;

/**
 * 归并 / 认领 legacy 档案的写路径（需事务包裹）。
 *
 * 判定顺序：
 * 1. 绑定档案余额为 0 时，若门店内**唯一**存在一条未绑定且有余额的档案，
 *    视为该用户的孤儿余额并归并（避免误合并其它客户余额）；
 * 2. 命中间店同手机号的 legacy 档案：绑定档案存在则归并，不存在则 CAS 认领；
 * 3. 都未命中时返回绑定档案，或为当前用户建档。
 */
export async function resolveCustomerWithMerge(
  tx: Prisma.TransactionClient,
  storeId: number,
  clubUserId: number,
  boundCustomer: ClubActiveMarketingCustomer | null,
  legacyCustomer: ClubActiveMarketingCustomer | null,
  user: ClubCustomerDirectoryUser,
): Promise<ClubActiveMarketingCustomer | null> {
  // 新注册账号可能在手机号尚未同步前完成充值，余额会落在一条未绑定的
  // 客户记录。仅在门店内唯一存在该类记录时归并。
  // 归并完成后绑定档案余额必 > 0，因此只在余额为 0 时尝试，让已归并过的
  // 用户直接跳过这两次查询。
  if (boundCustomer && boundCustomer.balance === 0) {
    const unboundFundedCustomers = await tx.marketingCustomer.findMany({
      where: {
        storeId,
        clubUserId: null,
        balance: { gt: 0 },
        status: 'active',
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      take: 2,
      select: ACTIVE_CUSTOMER_SELECT,
    });
    if (unboundFundedCustomers.length === 1) {
      const merged = await mergeIntoBoundCustomer(
        tx,
        boundCustomer,
        unboundFundedCustomers[0],
      );
      if (merged) return merged;
    }
  }

  if (legacyCustomer) {
    if (boundCustomer) {
      const merged = await mergeIntoBoundCustomer(
        tx,
        boundCustomer,
        legacyCustomer,
      );
      if (merged) return merged;
    }
    const claimed = await tx.marketingCustomer.updateMany({
      where: { id: legacyCustomer.id, clubUserId: null },
      data: { clubUserId },
    });
    if (claimed.count > 0) return legacyCustomer;
  }

  if (boundCustomer) return boundCustomer;

  return createBoundCustomer(tx, storeId, clubUserId, user);
}

/**
 * 新建（或取回已存在的）绑定档案。
 *
 * 并发下单 / 落账可能同时都没读到绑定记录，因此这里必须用**单条原子 SQL**：
 * `createMany({ skipDuplicates })` 会被下推成 `INSERT ... ON CONFLICT DO NOTHING`，
 * 冲突时静默跳过并等待对方事务提交，再回读即可拿到同一条档案。
 *
 * 不能用 `upsert`：`(store_id, club_user_id)` 是**部分唯一索引**
 * （`WHERE club_user_id IS NOT NULL`），Prisma 无法据此下推 `ON CONFLICT`，
 * 会退化成「先查再插」；并发时 INSERT 分支直接抛 P2002，而在事务内抛错会让
 * 整个事务进入 aborted 状态，后续语句全部失败。真实库并发用例已验证该行为。
 */
export async function createBoundCustomer(
  client: Prisma.TransactionClient,
  storeId: number,
  clubUserId: number,
  user: ClubCustomerDirectoryUser,
): Promise<ClubActiveMarketingCustomer> {
  await client.marketingCustomer.createMany({
    data: [
      {
        storeId,
        clubUserId,
        name: user?.name?.trim() || 'Club 顾客',
        phone: user?.wechatPhone ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return client.marketingCustomer.findUniqueOrThrow({
    where: { storeId_clubUserId: { storeId, clubUserId } },
    select: ACTIVE_CUSTOMER_SELECT,
  });
}

/**
 * 把 source 档案的余额并入 boundCustomer，并软删 source。
 *
 * 并发防护：先以 CAS（balance + deleted_at 作为条件）抢占 source 档案。
 * 抢占失败说明另一个并发请求（支付落账与另一笔落账可能同时发起）已完成归并，
 * 此时改为重新读取绑定档案的实时余额返回；若两边都按各自读到的旧余额
 * increment，同一笔孤儿余额会被重复累加一次。
 */
export async function mergeIntoBoundCustomer(
  tx: Prisma.TransactionClient,
  boundCustomer: ClubActiveMarketingCustomer,
  source: ClubActiveMarketingCustomer,
): Promise<ClubActiveMarketingCustomer | null> {
  const claimed = await tx.marketingCustomer.updateMany({
    where: {
      id: source.id,
      clubUserId: null,
      balance: source.balance,
      deletedAt: null,
    },
    data: { status: 'inactive', deletedAt: new Date() },
  });
  if (claimed.count === 0) {
    return tx.marketingCustomer.findUnique({
      where: { id: boundCustomer.id },
      select: ACTIVE_CUSTOMER_SELECT,
    });
  }

  await tx.marketingCustomer.update({
    where: { id: boundCustomer.id },
    data: {
      balance: { increment: source.balance },
      phone: source.phone ?? boundCustomer.phone,
    },
  });
  return {
    id: boundCustomer.id,
    balance: boundCustomer.balance + source.balance,
    phone: source.phone ?? boundCustomer.phone,
  };
}
