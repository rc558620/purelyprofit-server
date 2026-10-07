import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubMenuCacheKey } from '../../redis/keys/club-cache-keys';
import { createHash } from 'node:crypto';

const CLUB_MENU_CACHE_TTL_SECONDS = 30;

@Injectable()
export class ClubScanOrderingMenuQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

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

    // 轻量查询：仅取分类 id+version 计算 menuVersion（不拉 products/specs/options）
    const versionRows = await this.prisma.scanOrderingMenuCategory.findMany({
      where: {
        storeId: session.storeId,
        isActive: true,
        deletedAt: null,
        products: { some: { deletedAt: null } },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, version: true },
    });
    const menuVersion = createHash('sha256')
      .update(JSON.stringify(versionRows.map((item) => [item.id, item.version])))
      .digest('hex');

    // 缓存命中检查：menuVersion 不变即命中
    const cacheKey = buildClubMenuCacheKey(session.storeId, menuVersion);
    const cached = await this.redisService.getJson<unknown>(cacheKey);
    if (cached) {
      return cached;
    }

    // 未命中：查完整 categories 数据
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
    const result = {
      menuVersion,
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

    // 写缓存（TTL 30s，menuVersion 变更后旧 key 自然过期）
    await this.redisService.setJson(
      cacheKey,
      result,
      CLUB_MENU_CACHE_TTL_SECONDS,
    );

    return result;
  }
}
