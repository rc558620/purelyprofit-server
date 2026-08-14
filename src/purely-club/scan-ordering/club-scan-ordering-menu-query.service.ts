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
        products: category.products.map((product) => {
          const baseStock = product.product
            ? product.product.stock
            : (product.stockQuantity ?? 0);
          return {
            ...product,
            imageUrl: product.product?.image ?? product.imageUrl,
            stockMode: product.product ? 'finite' : product.stockMode,
            // 可用库存 = 总库存 - 已下单未接单的预留量
            stockQuantity: Math.max(
              0,
              baseStock - (product.reservedQuantity ?? 0),
            ),
            // 规格可用库存同样扣除预留量
            specGroups: product.specGroups.map((group) => ({
              ...group,
              options: group.options.map((option) => ({
                ...option,
                stockQuantity:
                  option.stockQuantity === null
                    ? null
                    : Math.max(
                        0,
                        option.stockQuantity - (option.reservedQuantity ?? 0),
                      ),
              })),
            })),
            product: undefined,
          };
        }),
      })),
    };
  }
}
