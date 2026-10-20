import { ForbiddenException, Injectable } from '@nestjs/common';
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
    const promotionResult = await this.cartPricingService.resolvePromotions(
      session.storeId,
      user.id,
      session.id,
      pricedItems,
      dto.usePoints === true,
    );
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
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
    return session;
  }
}
