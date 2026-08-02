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
      if (boundCustomer && boundCustomer.balance > 0) return boundCustomer;

      // 新注册账号可能在手机号尚未同步前完成充值，余额会落在一条未绑定的
      // 客户记录。仅在门店内唯一存在该类记录时归并，避免误合并其它客户余额。
      const unboundFundedCustomers = boundCustomer
        ? await tx.marketingCustomer.findMany({
            where: {
              storeId,
              clubUserId: null,
              balance: { gt: 0 },
              status: 'active',
              deletedAt: null,
            },
            orderBy: { updatedAt: 'desc' },
            take: 2,
            select: { id: true, balance: true, phone: true },
          })
        : [];
      if (boundCustomer && unboundFundedCustomers.length === 1) {
        const unboundFundedCustomer = unboundFundedCustomers[0];
        await tx.marketingCustomer.update({
          where: { id: boundCustomer.id },
          data: {
            balance: { increment: unboundFundedCustomer.balance },
            phone: unboundFundedCustomer.phone ?? boundCustomer.phone,
          },
        });
        await tx.marketingCustomer.update({
          where: { id: unboundFundedCustomer.id },
          data: { status: 'inactive', deletedAt: new Date() },
        });
        return {
          id: boundCustomer.id,
          balance: boundCustomer.balance + unboundFundedCustomer.balance,
          phone: unboundFundedCustomer.phone ?? boundCustomer.phone,
        };
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
        if (boundCustomer) {
          await tx.marketingCustomer.update({
            where: { id: boundCustomer.id },
            data: {
              balance: { increment: legacyCustomer.balance },
              phone: legacyCustomer.phone ?? boundCustomer.phone,
            },
          });
          await tx.marketingCustomer.update({
            where: { id: legacyCustomer.id },
            data: { status: 'inactive', deletedAt: new Date() },
          });
          return {
            id: boundCustomer.id,
            balance: boundCustomer.balance + legacyCustomer.balance,
            phone: legacyCustomer.phone ?? boundCustomer.phone,
          };
        }
        const claimed = await tx.marketingCustomer.updateMany({
          where: { id: legacyCustomer.id, clubUserId: null },
          data: { clubUserId },
        });
        if (claimed.count > 0) return legacyCustomer;
      }

      if (boundCustomer) return boundCustomer;

      // 并发的订单预览请求可能都没有读到绑定记录；使用 upsert 防止其中一个
      // create 因 (storeId, clubUserId) 唯一约束失败。
      return tx.marketingCustomer.upsert({
        where: { storeId_clubUserId: { storeId, clubUserId } },
        create: {
          storeId,
          clubUserId,
          name: user?.name?.trim() || 'Club 顾客',
          phone: user?.wechatPhone ?? null,
        },
        update: {},
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
