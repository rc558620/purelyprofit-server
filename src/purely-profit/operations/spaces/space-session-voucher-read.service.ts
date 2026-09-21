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
   *
   * 门店口径：以【当前登录会员的门店作用域】为准，不接受前端传入的 storeId。
   * 前端 storeInfo 是持久化缓存，换号/切店后可能残留上一门店 ID；若据此做越权判定，
   * 会把「本店」误判成跨门店 → 403「无权在该门店读取团购券」（券码本身没问题的假失败）。
   * 空间管理页其余数据（空间列表 / 会话 / 预约）同样由服务端按当前会员门店解析，口径保持一致。
   */
  async readVoucher(
    user: AuthenticatedUser,
    voucherCode: string,
  ): Promise<ReadVoucherResult> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
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
