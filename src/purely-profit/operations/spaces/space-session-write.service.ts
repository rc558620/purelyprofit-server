import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AddSpaceSessionItemsDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import {
  mapSessionItemRows,
  toSpaceSessionResponse,
} from './space-sessions.mapper';
import { normalizeSessionItemsPayload } from './space-session-payload.shared';
import { mergeSessionItems, sumLineTotalMoney } from './space-session-items.shared';
import { applyInventoryDeductionsInTransaction } from '../../goods/inventory/inventory-stock.query';

@Injectable()
export class SpaceSessionWriteService {
  constructor(private readonly prisma: PrismaService) {}

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
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
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

    const appendedItems = normalizeSessionItemsPayload(dto.items);
    const inventorySyncMode = dto.inventorySyncMode ?? 'client';
    let operatorStaffId: number | null = null;

    // 如果采用 server 模式，需要提前获取操作者信息
    if (inventorySyncMode === 'server' && deps.findOperatorStaffIdForStore) {
      operatorStaffId = await deps.findOperatorStaffIdForStore(user, session.storeId);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
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
        })),
      });

      // 如果采用 server 模式，在事务中扣减库存
      if (inventorySyncMode === 'server') {
        // 筛出需要扣库存的商品（跳过 manual_, SYS_, 空 productId）
        const inventoryItems = appendedItems
          .filter((item) => {
            const productIdStr = String(item.productId).trim();
            // 跳过空、手动商品、系统商品
            if (!productIdStr || productIdStr.startsWith('manual_') || productIdStr.startsWith('SYS_')) {
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
          try {
            await applyInventoryDeductionsInTransaction(
              transaction,
              inventoryItems,
              latestSession.storeId,
              operatorStaffId,
              'sale',
              '空间管理追加点单',
            );
          } catch (error) {
            // 库存不足或商品不存在时，抛出错误由事务回滚
            throw error;
          }
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
    });

    return toSpaceSessionResponse(updated);
  }
}
