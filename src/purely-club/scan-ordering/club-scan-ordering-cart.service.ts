import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  MembershipDowngradeService,
  SCAN_ORDER_BLOCKED_MESSAGE,
} from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { computeCartVersion } from './club-scan-ordering-cart-pricing.utils';
import type {
  AddClubScanCartItemDto,
  UpdateClubScanCartItemDto,
} from './dto/club-scan-ordering.dto';

@Injectable()
export class ClubScanOrderingCartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly downgradeService: MembershipDowngradeService,
  ) {}

  async getCart(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    const session = await this.requireSession(user, sessionId);
    const items = await this.prisma.scanOrderingCartItem.findMany({
      where: { sessionId: session.id, status: 'active', deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      include: { specs: true },
    });
    return {
      sessionId: session.id,
      // 行级乐观锁版本之和：只用于粗粒度变更检测，不能当 cartVersion 用
      version: this.cartVersion(items),
      // 与 preview / create 同口径的购物车版本，可直接用于下单校验
      cartVersion: computeCartVersion(items),
      items,
    };
  }

  async quoteCartItem(
    user: AuthenticatedUser,
    dto: Pick<
      AddClubScanCartItemDto,
      'sessionId' | 'productId' | 'specOptionIds'
    >,
  ): Promise<{ unitPriceAmount: number }> {
    const session = await this.requireSession(user, dto.sessionId);
    const product = await this.loadProduct(session.storeId, dto.productId);
    this.assertPurchasable(product, 1);
    const options = this.validateOptions(product.specGroups, dto.specOptionIds);
    return {
      unitPriceAmount:
        product.basePrice +
        options.reduce((sum, option) => sum + option.extraPrice, 0),
    };
  }

  async addCartItem(
    user: AuthenticatedUser,
    dto: AddClubScanCartItemDto,
  ): Promise<unknown> {
    const session = await this.requireSession(user, dto.sessionId);

    // 会员过期门店停止新的下单流程；到期之前已开台的会话允许继续加点
    await this.downgradeService.assertStoreCanOrder(
      session.storeId,
      SCAN_ORDER_BLOCKED_MESSAGE,
      session.createdAt,
    );

    const product = await this.loadProduct(session.storeId, dto.productId);
    // 同一商品的不同规格会落在多条购物车行，库存必须按「该商品在购物车中的总量」校验，
    // 与下单时的 ClubScanOrderingInventoryReservationService 聚合口径保持一致。
    const cartQuantity = await this.resolveCartProductQuantity(
      session.id,
      product.id,
    );
    this.assertPurchasable(product, cartQuantity + dto.quantity);
    const options = this.validateOptions(product.specGroups, dto.specOptionIds);
    const specSignature = this.hash(
      [...dto.specOptionIds].sort((a, b) => a - b).join(','),
    );
    const unitPriceAmount =
      product.basePrice +
      options.reduce((sum, item) => sum + item.extraPrice, 0);

    // 并发首次加购同一规格会撞 (sessionId, menuProductId, specSignature) 的部分唯一
    // 索引：这里捕获 P2002 重试一次，重试时已能查到对方提交的行并走累加分支。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.writeCartItem(
          session.id,
          product.id,
          specSignature,
          dto.quantity,
          unitPriceAmount,
          options.map((option) => ({
            specOptionId: option.id,
            extraPriceSnapshot: option.extraPrice,
          })),
        );
        break;
      } catch (error) {
        if (attempt === 0 && this.isUniqueViolation(error)) continue;
        throw error;
      }
    }
    return this.getCart(user, session.id);
  }

  /** 购物车行写入：同规格已存在则累加，否则新建。 */
  private async writeCartItem(
    sessionId: number,
    menuProductId: number,
    specSignature: string,
    quantity: number,
    unitPriceAmount: number,
    specs: Array<{ specOptionId: number; extraPriceSnapshot: number }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.scanOrderingCartItem.findFirst({
        where: {
          sessionId,
          menuProductId,
          specSignature,
          status: 'active',
          deletedAt: null,
        },
      });
      if (existing) {
        const nextQuantity = existing.quantity + quantity;
        await tx.scanOrderingCartItem.update({
          where: { id: existing.id },
          data: {
            quantity: nextQuantity,
            lineTotalAmount: nextQuantity * unitPriceAmount,
            unitPriceAmount,
            version: { increment: 1 },
          },
        });
        return;
      }
      await tx.scanOrderingCartItem.create({
        data: {
          sessionId,
          menuProductId,
          specSignature,
          quantity,
          unitPriceAmount,
          lineTotalAmount: quantity * unitPriceAmount,
          specs: { create: specs },
        },
      });
    });
  }

  /** Prisma 唯一约束冲突（P2002）判定。 */
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  async updateCartItem(
    user: AuthenticatedUser,
    itemId: number,
    dto: UpdateClubScanCartItemDto,
  ): Promise<unknown> {
    const item = await this.prisma.scanOrderingCartItem.findFirst({
      where: { id: itemId, status: 'active', deletedAt: null },
      include: { session: true },
    });
    if (!item) throw new NotFoundException('购物车商品不存在');
    this.ensureSessionOwner(user, item.session);
    // 改量同样要校验库存：否则用户把步进器点到大数量也能成功，直到提交订单才被
    // 库存预留打回。口径＝本行新数量 + 该商品其它规格行已占数量。
    const product = await this.loadProduct(
      item.session.storeId,
      item.menuProductId,
    );
    const otherLineQuantity = await this.resolveCartProductQuantity(
      item.sessionId,
      item.menuProductId,
      item.id,
    );
    this.assertPurchasable(product, otherLineQuantity + dto.quantity);
    const result = await this.prisma.scanOrderingCartItem.updateMany({
      where: { id: itemId, version: dto.version, status: 'active' },
      data: {
        quantity: dto.quantity,
        lineTotalAmount: dto.quantity * item.unitPriceAmount,
        version: { increment: 1 },
      },
    });
    if (result.count === 0)
      throw new ConflictException('购物车已更新，请刷新后重试');
    return this.getCart(user, item.sessionId);
  }

  async removeCartItem(
    user: AuthenticatedUser,
    itemId: number,
    version: number,
  ): Promise<unknown> {
    const item = await this.prisma.scanOrderingCartItem.findFirst({
      where: { id: itemId, status: 'active', deletedAt: null },
      include: { session: true },
    });
    if (!item) throw new NotFoundException('购物车商品不存在');
    this.ensureSessionOwner(user, item.session);
    const result = await this.prisma.scanOrderingCartItem.updateMany({
      where: { id: itemId, version, status: 'active' },
      data: {
        status: 'removed',
        deletedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0)
      throw new ConflictException('购物车已更新，请刷新后重试');
    return this.getCart(user, item.sessionId);
  }

  /** 读取菜单商品（含共享商品库存），不存在或不可售时抛错。 */
  private async loadProduct(storeId: number, productId: number) {
    const product = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { id: productId, storeId, isActive: true, deletedAt: null },
      include: {
        product: {
          select: { isActive: true, deletedAt: true, stock: true },
        },
        specGroups: {
          where: { isActive: true },
          include: { options: { where: { isActive: true } } },
        },
      },
    });
    if (!product) throw new ConflictException('商品已售罄或库存不足');
    return product;
  }

  /**
   * 校验该商品在购物车中的目标总量是否可满足。
   *
   * 可用库存口径必须与下单时一致：总库存 − 已预留量（未接单订单占用的预留），
   * 且共享商品（product.stock）停用/删除时同样不可售。
   */
  private assertPurchasable(
    product: {
      stockMode: string;
      stockQuantity: number | null;
      reservedQuantity: number | null;
      product: {
        isActive: boolean;
        deletedAt: Date | null;
        stock: number;
      } | null;
    },
    requiredTotal: number,
  ): void {
    const inventoryProduct = product.product;
    const baseStock = inventoryProduct
      ? inventoryProduct.stock
      : (product.stockQuantity ?? 0);
    const availableStock = baseStock - (product.reservedQuantity ?? 0);
    if (
      product.stockMode === 'sold_out' ||
      (inventoryProduct &&
        (!inventoryProduct.isActive || inventoryProduct.deletedAt)) ||
      (product.stockMode === 'finite' && availableStock < requiredTotal)
    ) {
      throw new ConflictException('商品已售罄或库存不足');
    }
  }

  /** 该商品在购物车中的活跃行数量合计（可排除指定行）。 */
  private async resolveCartProductQuantity(
    sessionId: number,
    menuProductId: number,
    excludeCartItemId?: number,
  ): Promise<number> {
    const items = await this.prisma.scanOrderingCartItem.findMany({
      where: {
        sessionId,
        menuProductId,
        status: 'active',
        deletedAt: null,
        ...(excludeCartItemId ? { id: { not: excludeCartItemId } } : {}),
      },
      select: { quantity: true },
    });
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }

  private async requireSession(
    user: AuthenticatedUser,
    sessionId: number | undefined,
  ) {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        ...(sessionId ? { id: sessionId } : {}),
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
      include: { table: true },
    });
    if (!session)
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
    return session;
  }

  private ensureSessionOwner(
    user: AuthenticatedUser,
    session: {
      clubUserId: number | null;
      status: string;
      expiresAt: Date;
      deletedAt: Date | null;
    },
  ): void {
    if (
      session.clubUserId !== user.id ||
      session.status !== 'active' ||
      session.expiresAt <= new Date() ||
      session.deletedAt
    )
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
  }

  private validateOptions(
    groups: Array<{
      id: number;
      minSelections: number;
      maxSelections: number | null;
      options: Array<{ id: number; extraPrice: number }>;
    }>,
    selectedIds: number[],
  ): Array<{ id: number; extraPrice: number }> {
    const selected = new Set(selectedIds);
    const options = groups.flatMap((group) =>
      group.options.filter((option) => selected.has(option.id)),
    );
    if (options.length !== selected.size)
      throw new BadRequestException('商品规格选择不符合要求');
    for (const group of groups) {
      const count = options.filter((option) =>
        group.options.some((candidate) => candidate.id === option.id),
      ).length;
      if (
        count < group.minSelections ||
        (group.maxSelections !== null && count > group.maxSelections)
      ) {
        throw new BadRequestException('商品规格选择不符合要求');
      }
    }
    return options;
  }

  private cartVersion(items: Array<{ version: number }>): number {
    return items.reduce((sum, item) => sum + item.version, 0);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
