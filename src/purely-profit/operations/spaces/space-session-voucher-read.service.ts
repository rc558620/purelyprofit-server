// 空间会话-纯利宝团购券读取服务：商家输入券码读取顾客信息与券面金额（开台回填数据源）
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  assertVoucherReadable,
  type ReadVoucherResult,
} from './space-session-voucher.shared';

@Injectable()
export class SpaceSessionVoucherReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /**
   * 读取纯利宝团购券：校验门店权限 + 券可读性，返回开台表单回填所需信息。
   * used-已开台的券抛出"该团购券已使用"。
   */
  async readVoucher(
    user: AuthenticatedUser,
    storeId: number,
    voucherCode: string,
  ): Promise<ReadVoucherResult> {
    await this.commerceAccessService.ensureCanAccessStore(
      user,
      storeId,
      'operation-entry:create',
      '无权在该门店读取团购券',
    );

    const order = await assertVoucherReadable(
      this.prisma,
      voucherCode.trim(),
      storeId,
    );

    // purelyClub 在途余额：读取该顾客在购买门店的储值余额（无顾客档案时按 0 处理）
    const balanceFen =
      order.customerId !== null
        ? ((
            await this.prisma.marketingCustomer.findUnique({
              where: { id: order.customerId },
              select: { balance: true },
            })
          )?.balance ?? 0)
        : 0;

    // 开台计费预配置：读取券对应营销产品（仅团购券商品提供，供开台快速回填）
    const product = await this.prisma.marketingProduct.findUnique({
      where: { id: order.productId },
      select: {
        type: true,
        billingMode: true,
        hourlyRate: true,
        countdownMinutes: true,
        countdownPrice: true,
        autoCheckout: true,
      },
    });
    const billing =
      product !== null && product.type === 'voucher'
        ? {
            billingMode: product.billingMode,
            hourlyRateFen: product.hourlyRate,
            countdownMinutes: product.countdownMinutes,
            countdownPriceFen: product.countdownPrice,
            autoCheckout: product.autoCheckout,
          }
        : undefined;

    return {
      platform: order.platform,
      voucherCode: order.voucherCode ?? voucherCode.trim(),
      guestName: order.guestName,
      guestPhone: order.guestPhone,
      personCount: order.personCount,
      guestType: order.guestType,
      faceAmountFen: order.paidAmountFen,
      balanceFen,
      productName: order.productName,
      quantity: order.quantity,
      status: order.status,
      billing,
    };
  }
}
