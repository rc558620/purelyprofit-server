import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import type {
  AddSpaceSessionItemsDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import {
  mapSessionItemRows,
  toSpaceSessionResponse,
} from './space-sessions.mapper';
import {
  normalizeSessionItemsPayload,
  type SessionItemPayloadInput,
} from './space-session-payload.shared';
import {
  mergeSessionItems,
  sumLineTotalMoney,
} from './space-session-items.shared';
import { applyInventoryDeductionsInTransaction } from '../../goods/inventory/inventory-stock.query';
import { ProductSpecPricingService } from '../../goods/products/product-spec-pricing.service';
import type { SpaceSessionItemDto } from './dto/space-session-items.request.dto';

@Injectable()
export class SpaceSessionWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly specPricing: ProductSpecPricingService,
  ) {}

  async addItemsToSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: AddSpaceSessionItemsDto,
    deps: {
      ensureCanAccessStore: (
        user: AuthenticatedUser,
        storeId: number,
        permission: string,
        message: string,
      ) => Promise<void>;
      findOperatorStaffIdForStore?: (
        user: AuthenticatedUser,
        storeId: number,
      ) => Promise<number | null>;
    },
  ): Promise<SpaceSessionResponseDto> {
    // BUG-1 fix: 与 checkout / list / detail 的 deletedAt: null 口径一致
    const session = await this.prisma.spaceSession.findFirst({
      where: {
        id: sessionId,
        space: { deletedAt: null },
      },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await deps.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间追加商品',
    );

    const appendedItems = normalizeSessionItemsPayload(
      await this.priceAppendedItems(session.storeId, dto.items),
    );
    const inventorySyncMode = dto.inventorySyncMode ?? 'client';
    let operatorStaffId: number | null = null;

    // 如果采用 server 模式，需要提前获取操作者信息
    if (inventorySyncMode === 'server' && deps.findOperatorStaffIdForStore) {
      operatorStaffId = await deps.findOperatorStaffIdForStore(
        user,
        session.storeId,
      );
    }

    const updated = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
        SELECT id
        FROM space_sessions
        WHERE id = ${sessionId}
        FOR UPDATE
      `;

        const latestSession = await transaction.spaceSession.findUnique({
          where: { id: sessionId },
          include: {
            space: {
              select: {
                id: true,
                name: true,
                type: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            sessionItems: {
              orderBy: { sortOrder: 'asc' },
            },
            sessionRenewRecords: {
              orderBy: { id: 'asc' },
            },
          },
        });

        if (!latestSession) {
          throw new NotFoundException('空间会话不存在');
        }

        if (latestSession.status !== PrismaSpaceSessionStatus.active) {
          throw new ConflictException('当前会话已结账，无法继续点单');
        }

        // Step 8.1: 从子表行映射为业务记录再合并
        const currentItems = mapSessionItemRows(latestSession.sessionItems);
        const mergedItems = mergeSessionItems(currentItems, appendedItems);
        const nextItemsCostMoney = sumLineTotalMoney(mergedItems);

        // Step 8.1: 删除旧的 items，重新创建
        await transaction.spaceSessionItem.deleteMany({
          where: { sessionId: latestSession.id },
        });

        await transaction.spaceSessionItem.createMany({
          data: mergedItems.map((item, index) => ({
            sessionId: latestSession.id,
            productId: item.productId,
            productName: item.productName,
            categoryName: item.categoryName,
            // mergedItems 中的 salePrice/profit 是元，DB 存储为分
            salePrice: Money.fromInputYuan(item.salePrice).toDbCents(),
            profit: Money.fromInputYuan(item.profit).toDbCents(),
            quantity: item.quantity,
            sortOrder: index,
            // 保留来源标记（自助下单等），结算时据此生成抵扣防重复收费
            sourceType: item.sourceType ?? null,
            sourceOrderNo: item.sourceOrderNo ?? null,
            sourceOrderItemId: item.sourceOrderItemId ?? null,
            specSignature: item.specSignature ?? null,
            // 规格名快照：无规格时保持 NULL（Prisma 的 nullable Json 不写即 NULL）
            ...(item.specNames && item.specNames.length > 0
              ? { specNames: item.specNames }
              : {}),
          })),
        });

        // 如果采用 server 模式，在事务中扣减库存
        if (inventorySyncMode === 'server') {
          // 筛出需要扣库存的商品（跳过 manual_, SYS_, 空 productId）
          const inventoryItems = appendedItems
            .filter((item) => {
              const productIdStr = String(item.productId).trim();
              // 跳过空、手动商品、系统商品
              if (
                !productIdStr ||
                productIdStr.startsWith('manual_') ||
                productIdStr.startsWith('SYS_')
              ) {
                return false;
              }
              // 尝试转换为 int
              const parsed = parseInt(productIdStr, 10);
              return !Number.isNaN(parsed) && parsed > 0;
            })
            .map((item) => ({
              productId: parseInt(String(item.productId), 10),
              quantity: Math.max(0, Math.floor(item.quantity)),
              productName: item.productName,
            }))
            .filter((item) => item.quantity > 0);

          // 如果有真实商品，执行库存扣减
          if (inventoryItems.length > 0) {
            await applyInventoryDeductionsInTransaction(
              transaction,
              inventoryItems,
              latestSession.storeId,
              operatorStaffId,
              'sale',
              '空间管理追加点单',
            );
          }
        }

        return transaction.spaceSession.update({
          where: { id: latestSession.id },
          data: {
            // nextItemsCostMoney 是 Money 对象，直接转分
            itemsCost: nextItemsCostMoney.toDbCents(),
          },
          include: {
            space: {
              select: {
                id: true,
                name: true,
                type: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            sessionItems: {
              orderBy: { sortOrder: 'asc' },
            },
            sessionRenewRecords: {
              orderBy: { id: 'asc' },
            },
          },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    return toSpaceSessionResponse(updated);
  }

  /**
   * 服务端权威定价：以 ProductSpecPricingService 重算单价/利润/展示名。
   *
   * 只对数字型 productId（真实商品库商品）生效；`manual_` / `SYS_` 等虚拟行沿用前端传值。
   * 带规格的行定价失败一律抛错（不能静默丢弃规格）；无规格行若商品不可定价
   * （如已删除/已下架）则回退到前端传值，保持改造前的行为。
   */
  private async priceAppendedItems(
    storeId: number,
    items: SpaceSessionItemDto[],
  ): Promise<SessionItemPayloadInput[]> {
    return Promise.all(
      items.map(async (item): Promise<SessionItemPayloadInput> => {
        const productId = Number.parseInt(item.productId.trim(), 10);
        const hasSpecs = (item.specOptionIds?.length ?? 0) > 0;

        if (!Number.isInteger(productId) || productId <= 0) {
          return { ...item, specSignature: null, specNames: null };
        }

        try {
          const priced = await this.specPricing.price({
            storeId,
            productId,
            specOptionIds: item.specOptionIds,
          });
          return {
            ...item,
            // 展示名已含规格后缀（如「可乐（大杯）」），小票与明细直接可读
            productName: priced.displayName,
            salePrice: Money.fromDbCents(priced.unitPriceCents).toOutputYuan(),
            profit: Money.fromDbCents(priced.profitCents).toOutputYuan(),
            specSignature: priced.specSignature,
            specNames: priced.specNames,
          };
        } catch (error) {
          if (hasSpecs) throw error;
          return { ...item, specSignature: null, specNames: null };
        }
      }),
    );
  }
}
