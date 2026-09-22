import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface ClubRechargeCustomerSnapshot {
  id: number;
}

/**
 * 充值 / 自助点单场景下定位（必要时创建）当前用户的营销顾客档案。
 *
 * 认人顺序与 ClubScanOrderingMarketingCustomerService.resolveActiveCustomer 对齐：
 *   1. (storeId, clubUserId) 稳定键 —— 唯一可信的归属依据；
 *   2. 认领同门店「未绑定 + 同手机号」的孤儿档案，并**落上 clubUserId**；
 *   3. upsert 建档。
 *
 * ⚠️ 第 2 步必须写 clubUserId 而不只是返回。早期实现命中孤儿档案后直接返回、
 * 不落归属，于是 ClubPhoneRebindService.syncPhoneAcrossProfiles（只按 clubUserId 定位）
 * 会整店漏同步 → members.phone 留在旧号 → 用户换绑后当场失去这家门店。
 */
@Injectable()
export class ClubRechargeContextService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCurrentCustomer(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubRechargeCustomerSnapshot> {
    const bound = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId, deletedAt: null },
      select: { id: true },
    });
    if (bound) {
      return bound;
    }

    // 认领同号孤儿档案：同一门店存在多条时只认领 id 最小的一条，
    // 其余留给人工/回填脚本，避免连锁改写（与 claimUnboundCustomers 同策略）。
    const orphan = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId: null, phone, deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (orphan) {
      const claimed = await this.prisma.marketingCustomer.updateMany({
        where: { id: orphan.id, clubUserId: null },
        data: { clubUserId },
      });
      if (claimed.count > 0) {
        return orphan;
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: clubUserId },
      select: { name: true, wechatPhone: true },
    });

    // upsert 而非 create：并发请求同时走到这里时，create 会撞
    // uq_marketing_customers_store_club_user 部分唯一索引。
    return this.prisma.marketingCustomer.upsert({
      where: { storeId_clubUserId: { storeId, clubUserId } },
      create: {
        storeId,
        clubUserId,
        name: user?.name?.trim() || 'Club 顾客',
        phone: user?.wechatPhone ?? null,
      },
      update: {},
      select: { id: true },
    });
  }
}
