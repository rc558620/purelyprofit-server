import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import type { PreviewClubScanOrderDto } from './dto/club-scan-ordering.dto';

@Injectable()
export class ClubScanOrderingOrderPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartPricingService: ClubScanOrderingCartPricingService,
  ) {}

  async preview(
    user: AuthenticatedUser,
    dto: PreviewClubScanOrderDto,
  ): Promise<unknown> {
    const session = await this.requireSession(user, dto.sessionId);
    // 定价与定价版本共用一次取数（省掉版本计算的重复查询）
    const { items: pricedItems, pricingVersion } =
      await this.cartPricingService.priceCartWithPricingVersion(
        session.id,
        session.storeId,
      );
    const cartVersion = this.cartPricingService.cartVersion(pricedItems);
    // 预览是只读接口：顾客档案不存在时按「无会员资产」计价（积分 0、消费次数 0），
    // 建档 / 归并留到下单与支付落账。此前这里会 upsert 建档 + 跑归并事务，
    // 使最高频的预览接口持续写库。
    const promotionResult = await this.cartPricingService.resolvePromotions({
      storeId: session.storeId,
      clubUserId: user.id,
      pricedItems,
      usePoints: dto.usePoints === true,
      customerLookup: 'existing',
    });
    const amounts = this.cartPricingService.calculateAmounts(
      pricedItems,
      promotionResult,
    );
    return this.cartPricingService.toPreview(
      session.id,
      dto,
      pricedItems,
      cartVersion,
      pricingVersion,
      amounts,
      promotionResult,
    );
  }

  private async requireSession(user: AuthenticatedUser, sessionId: number) {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });
    if (!session?.tableId)
      throw new ForbiddenException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_TABLE_SESSION_UNAVAILABLE,
          '当前桌台会话不可用，请重新扫码',
        ),
      );
    return session;
  }
}
