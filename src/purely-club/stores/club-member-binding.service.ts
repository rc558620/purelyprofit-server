import { Injectable } from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';

/** 入店绑定结果：isNewMember 表示会员档案是否本次首次创建（用于渠道拉新计数） */
export interface ClubMemberBindingResult {
  isNewMember: boolean;
}

/**
 * 门店会员档案绑定服务。
 *
 * 负责用户加入门店时的事务化档案同步：
 * - Member 档案：存在则更新昵称，不存在则创建；
 * - MarketingCustomer 档案：存在则更新昵称，不存在则创建；
 * - 返回是否为新会员，供渠道拉新归因使用。
 */
@Injectable()
export class ClubMemberBindingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在事务内同步 Member / MarketingCustomer 档案。
   *
   * 同一门店 + 手机号维度幂等：已存在档案只更新昵称，不重复创建。
   *
   * `clubUserId` 用于识别「已按 club_user_id 绑定、但 phone 仍缺失」的营销顾客档案：
   * 扫码点餐链路的 `resolveActiveCustomer` 在用户尚未绑手机号时会把 phone 落成 null。
   * 不传该参数时行为与原先一致——只按 phone 匹配。
   */
  async upsertMemberAndCustomer(
    storeId: number,
    phone: string,
    displayName: string,
    clubUserId?: number,
  ): Promise<ClubMemberBindingResult> {
    let isNewMember = false;

    await this.prisma.$transaction(
      async (tx) => {
        // 多取一列 name：昵称未变化时跳过 UPDATE。扫码进桌是最高频写路径，
        // 「每次扫码都无条件写一遍同样的昵称」会持续制造无效死元组。
        const existingMemberRecord = await tx.member.findFirst({
          where: {
            storeId,
            phone,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
          },
        });

        if (existingMemberRecord) {
          if (existingMemberRecord.name !== displayName) {
            await tx.member.update({
              where: { id: existingMemberRecord.id },
              data: {
                name: displayName,
              },
            });
          }
        } else {
          await tx.member.create({
            data: {
              storeId,
              name: displayName,
              phone,
            },
          });
          isNewMember = true;
        }

        // 优先按 club_user_id 复用：否则「只有 club_user_id、phone 为 null」的既有档案
        // 匹配不到，会为同一顾客重复创建一条营销档案。
        //
        // 原先「先按 clubUserId 查、未命中再按 phone 查」是 2 次串行往返，位于扫码进桌
        // 最高频写路径的事务内，会把事务与行锁一并拉长。这里合并为 1 次 OR 查询：
        // clubUserId 上有 (storeId, clubUserId) 唯一约束，等值命中至多 1 行；
        // ORDER BY clubUserId ASC 在 PostgreSQL 下等价于 NULLS LAST，
        // 因此已绑定档案必然排在按手机号命中的历史档案之前，取数优先序与原先一致。
        const candidateCustomers = await tx.marketingCustomer.findMany({
          where: {
            storeId,
            deletedAt: null,
            ...(clubUserId ? { OR: [{ clubUserId }, { phone }] } : { phone }),
          },
          select: { id: true, name: true, phone: true, clubUserId: true },
          orderBy: [{ clubUserId: 'asc' }, { id: 'asc' }],
          // 已绑定档案 + 至多两条历史手机号档案，足够判定归属；再多也与语义无关
          take: 3,
        });
        const boundCustomerRecord = clubUserId
          ? (candidateCustomers.find(
              (customer) => customer.clubUserId === clubUserId,
            ) ?? null)
          : null;
        const matchedCustomerRecord =
          boundCustomerRecord ??
          candidateCustomers.find((customer) => customer.phone === phone) ??
          null;

        if (matchedCustomerRecord) {
          // 补齐历史档案缺失的 club_user_id。
          //
          // 早期的「邀请码/扫码入店」路径创建顾客档案时没有写入 clubUserId，
          // 这些档案在 ClubPhoneRebindProfilesService.syncPhoneAcrossProfiles 里只靠 clubUserId
          // 定位，于是**换绑手机号会整店漏掉**——members.phone 留在旧号，用户当场
          // 失去该门店访问权，商家端营销档案也仍旧号，再消费时还会分裂出第二条档案。
          // 认领条件收紧为「尚未绑定 club 用户 + 本人在该门店没有已绑定档案」，
          // 后者同时规避 uq_marketing_customers_store_club_user 唯一约束冲突。
          const needsClubBinding =
            Boolean(clubUserId) &&
            matchedCustomerRecord.clubUserId == null &&
            boundCustomerRecord === null;

          // 三个字段各自判定：都为「已是最新」时不发 UPDATE。
          // marketing_customers 是扫码/消费的高频写表，无条件覆写同值会持续产生死元组。
          const customerUpdateData = {
            ...(matchedCustomerRecord.name !== displayName
              ? { name: displayName }
              : {}),
            // 仅在 phone 缺失时补齐，绝不覆盖已有真实手机号
            ...(clubUserId && matchedCustomerRecord.phone === null
              ? { phone }
              : {}),
            ...(needsClubBinding ? { clubUserId } : {}),
          };

          if (Object.keys(customerUpdateData).length > 0) {
            await tx.marketingCustomer.update({
              where: { id: matchedCustomerRecord.id },
              data: customerUpdateData,
            });
          }
        } else {
          await tx.marketingCustomer.create({
            data: {
              storeId,
              name: displayName,
              phone,
              // 落上 club_user_id，避免后续 resolveActiveCustomer 按
              // (storeId, clubUserId) 找不到而重复建档
              ...(clubUserId ? { clubUserId } : {}),
            },
          });
        }
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    return { isNewMember };
  }
}
