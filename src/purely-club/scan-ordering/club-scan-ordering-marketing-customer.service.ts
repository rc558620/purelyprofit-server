import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClubScanOrderingMarketingCustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActiveCustomer(
    storeId: number,
    clubUserId: number,
  ): Promise<{ id: number; balance: number; phone: string | null }> {
    const customer = await this.prisma.$transaction(async (tx) => {
      const boundCustomer = await tx.marketingCustomer.findFirst({
        where: { storeId, clubUserId, status: 'active', deletedAt: null },
        select: { id: true, balance: true, phone: true },
      });
      if (boundCustomer) {
        const hasUnboundFundedCustomer = await tx.marketingCustomer.findFirst({
          where: {
            storeId,
            clubUserId: null,
            balance: { gt: 0 },
            status: 'active',
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!hasUnboundFundedCustomer || boundCustomer.balance > 0) {
          return boundCustomer;
        }
      }

      const user = await tx.user.findUnique({
        where: { id: clubUserId },
        select: { name: true, wechatPhone: true },
      });
      const legacyCustomer = user?.wechatPhone
        ? await tx.marketingCustomer.findFirst({
            where: {
              storeId,
              clubUserId: null,
              phone: user.wechatPhone,
              status: 'active',
              deletedAt: null,
            },
            select: { id: true, balance: true, phone: true },
          })
        : null;
      if (legacyCustomer) {
        const claimed = await tx.marketingCustomer.updateMany({
          where: { id: legacyCustomer.id, clubUserId: null },
          data: { clubUserId },
        });
        if (claimed.count > 0) return legacyCustomer;
      }

      return tx.marketingCustomer.create({
        data: {
          storeId,
          clubUserId,
          name: user?.name?.trim() || 'Club 顾客',
          phone: user?.wechatPhone ?? null,
        },
        select: { id: true, balance: true, phone: true },
      });
    });
    if (!customer) {
      throw new ConflictException(
        '当前门店未开通余额支付，请先完成会员绑定或充值',
      );
    }
    return customer;
  }
}
