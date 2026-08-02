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
import type {
  AddClubScanCartItemDto,
  UpdateClubScanCartItemDto,
} from './dto/club-scan-ordering.dto';

@Injectable()
export class ClubScanOrderingCartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    const session = await this.requireSession(user, sessionId);
    const items = await this.prisma.scanOrderingCartItem.findMany({
      where: { sessionId: session.id, status: 'active', deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      include: { specs: true },
    });
    return { sessionId: session.id, version: this.cartVersion(items), items };
  }

  async quoteCartItem(
    user: AuthenticatedUser,
    dto: Pick<
      AddClubScanCartItemDto,
      'sessionId' | 'productId' | 'specOptionIds'
    >,
  ): Promise<{ unitPriceAmount: number }> {
    const session = await this.requireSession(user, dto.sessionId);
    const product = await this.findAvailableProduct(
      session.storeId,
      dto.productId,
      1,
    );
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
    const product = await this.findAvailableProduct(
      session.storeId,
      dto.productId,
      dto.quantity,
    );
    const options = this.validateOptions(product.specGroups, dto.specOptionIds);
    const specSignature = this.hash(
      [...dto.specOptionIds].sort((a, b) => a - b).join(','),
    );
    const unitPriceAmount =
      product.basePrice +
      options.reduce((sum, item) => sum + item.extraPrice, 0);
    const existing = await this.prisma.scanOrderingCartItem.findFirst({
      where: {
        sessionId: session.id,
        menuProductId: product.id,
        specSignature,
        status: 'active',
        deletedAt: null,
      },
    });
    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        const quantity = existing.quantity + dto.quantity;
        await tx.scanOrderingCartItem.update({
          where: { id: existing.id },
          data: {
            quantity,
            lineTotalAmount: quantity * unitPriceAmount,
            unitPriceAmount,
            version: { increment: 1 },
          },
        });
        return;
      }
      await tx.scanOrderingCartItem.create({
        data: {
          sessionId: session.id,
          menuProductId: product.id,
          specSignature,
          quantity: dto.quantity,
          unitPriceAmount,
          lineTotalAmount: dto.quantity * unitPriceAmount,
          specs: {
            create: options.map((option) => ({
              specOptionId: option.id,
              extraPriceSnapshot: option.extraPrice,
            })),
          },
        },
      });
    });
    return this.getCart(user, session.id);
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

  private async findAvailableProduct(
    storeId: number,
    productId: number,
    quantity: number,
  ) {
    const product = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { id: productId, storeId, isActive: true, deletedAt: null },
      include: {
        specGroups: {
          where: { isActive: true },
          include: { options: { where: { isActive: true } } },
        },
      },
    });
    if (
      !product ||
      product.stockMode === 'sold_out' ||
      (product.stockMode === 'finite' &&
        (product.stockQuantity ?? 0) < quantity)
    ) {
      throw new ConflictException('商品已售罄或库存不足');
    }
    return product;
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
