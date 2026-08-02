import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash } from 'node:crypto';

@Injectable()
export class ClubScanOrderingMenuQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getMenu(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });
    if (!session)
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
    const categories = await this.prisma.scanOrderingMenuCategory.findMany({
      where: {
        storeId: session.storeId,
        isActive: true,
        deletedAt: null,
        products: { some: { deletedAt: null } },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        products: {
          where: { isActive: true, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            product: {
              select: {
                stock: true,
                image: true,
                isActive: true,
                deletedAt: true,
              },
            },
            specGroups: {
              where: { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                },
              },
            },
          },
        },
      },
    });
    return {
      menuVersion: createHash('sha256')
        .update(
          JSON.stringify(categories.map((item) => [item.id, item.version])),
        )
        .digest('hex'),
      categories: categories.map((category) => ({
        ...category,
        products: category.products.map((product) => ({
          ...product,
          imageUrl: product.product?.image ?? product.imageUrl,
          stockMode: product.product ? 'finite' : product.stockMode,
          stockQuantity: product.product
            ? product.product.stock
            : product.stockQuantity,
          product: undefined,
        })),
      })),
    };
  }
}
