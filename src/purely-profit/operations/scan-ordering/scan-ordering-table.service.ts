import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CreateScanOrderingTableDto,
  UpdateScanOrderingTableDto,
} from './dto/scan-ordering-table.dto';
import {
  ScanOrderingQrService,
  type ScanOrderingQrCodeResponse,
} from './scan-ordering-qr.service';
import { Logger } from '@nestjs/common';

/** 商家桌台卡片响应，订单数由数据库聚合后返回。 */
export interface ScanOrderingCreatedTableResponse extends ScanOrderingTableResponse {
  /** 新增桌台时自动生成的首个桌码。 */
  qrCode: ScanOrderingQrCodeResponse;
}

export interface ScanOrderingTableResponse {
  /** 桌台主键。 */
  id: number;
  /** 桌台业务编号。 */
  tableCode: string;
  /** 桌台展示名称。 */
  name: string;
  /** 桌台状态。 */
  status: 'empty' | 'dining' | 'clearing' | 'disabled';
  /** 当前活跃订单数量。 */
  activeOrderCount: number;
  /** 当前就餐人数。 */
  guestCount: number;
  /** 当前活跃会话；空桌时为 null。 */
  activeSession: {
    id: number;
    startedAt: string;
    guestCount: number;
    status: 'active' | 'checked_out' | 'expired' | 'left';
  } | null;
  /** 当前活跃会话中的进行中订单。 */
  activeOrders: Array<{
    id: number;
    orderNo: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    totalAmount: number;
    createdAt: string;
  }>;
  /** 所属区域 ID。 */
  areaId: number | null;
  /** 所属区域名称。 */
  areaName: string | null;
  /** 桌台类型 ID。 */
  typeId: number | null;
  /** 桌台类型名称。 */
  typeName: string | null;
}

/** 商家扫码点餐桌台查询服务。 */
@Injectable()
export class ScanOrderingTableService {
  private readonly logger = new Logger(ScanOrderingTableService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly qrService: ScanOrderingQrService,
  ) {}

  async createTable(
    user: AuthenticatedUser,
    dto: CreateScanOrderingTableDto,
  ): Promise<ScanOrderingCreatedTableResponse> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:table-manage',
    );

    // 尝试创建桌台，遇到唯一约束冲突时使用 upsert 模式复用已禁用记录
    let table;
    try {
      table = await this.prisma.scanOrderingTable.create({
        data: {
          storeId,
          tableCode: dto.tableCode,
          name: dto.name,
          capacity: dto.capacity ?? 1,
          areaId: dto.areaId ?? null,
          typeId: dto.typeId ?? null,
        },
      });
    } catch (error) {
      // 检查是否为唯一约束冲突
      if (
        error.message?.includes('Unique constraint') ||
        error.code === 'P2002' // Prisma 唯一约束错误码
      ) {
        this.logger.warn(
          `检测到桌台 ${storeId}/${dto.tableCode} 的唯一约束冲突，尝试复用已禁用记录`,
        );

        // 查找同 store+tableCode 但已禁用的旧记录
        const disabledTable = await this.prisma.scanOrderingTable.findFirst({
          where: {
            storeId,
            tableCode: dto.tableCode,
            OR: [{ deletedAt: { not: null } }, { isActive: false }],
          },
        });

        if (disabledTable) {
          const now = new Date();
          // 激活该旧记录
          table = await this.prisma.$transaction(async (tx) => {
            // 先清理旧二维码，避免下次 createInitialQrCode 冲突
            await tx.scanOrderingTableQrCode.updateMany({
              where: { tableId: disabledTable.id, status: 'active' },
              data: { status: 'revoked', revokedAt: now },
            });

            // 激活桌台
            return tx.scanOrderingTable.update({
              where: { id: disabledTable.id },
              data: {
                name: dto.name,
                capacity: dto.capacity ?? 1,
                areaId: dto.areaId ?? null,
                typeId: dto.typeId ?? null,
                isActive: true,
                status: 'empty',
                deletedAt: null,
                version: { increment: 1 },
              },
            });
          });
        } else {
          // 不应到达这里，抛出原始错误
          throw new ConflictException('桌台编号已存在');
        }
      } else {
        throw error;
      }
    }

    const qrCode = await this.qrService.createInitialQrCode(storeId, table.id);

    return {
      id: table.id,
      tableCode: table.tableCode,
      name: table.name,
      status: table.status,
      activeOrderCount: 0,
      guestCount: 0,
      activeSession: null,
      activeOrders: [],
      areaId: table.areaId,
      areaName: null,
      typeId: table.typeId,
      typeName: null,
      qrCode,
    };
  }

  async updateTable(
    user: AuthenticatedUser,
    tableId: number,
    dto: UpdateScanOrderingTableDto,
  ): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:table-manage',
    );
    const result = await this.prisma.scanOrderingTable.updateMany({
      where: { id: tableId, storeId, deletedAt: null },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.isActive !== undefined
          ? {
              isActive: dto.isActive,
              status: dto.isActive ? undefined : 'disabled',
            }
          : {}),
        ...(dto.areaId !== undefined ? { areaId: dto.areaId } : {}),
        ...(dto.typeId !== undefined ? { typeId: dto.typeId } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('扫码点餐桌台不存在');
    }
  }

  async removeTable(user: AuthenticatedUser, tableId: number): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:table-manage',
    );

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.scanOrderingTable.updateMany({
        where: { id: tableId, storeId, deletedAt: null },
        data: {
          isActive: false,
          status: 'disabled',
          deletedAt: now,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new NotFoundException('扫码点餐桌台不存在');

      await tx.scanOrderingTableQrCode.updateMany({
        where: { tableId, status: 'active' },
        data: { status: 'revoked', revokedAt: new Date() },
      });
    });
  }

  async clearTable(user: AuthenticatedUser, tableId: number): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:table-manage',
    );
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: tableId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!table) {
      throw new NotFoundException('扫码点餐桌台不存在');
    }
    const blockingOrderCount = await this.prisma.scanOrders.count({
      where: {
        storeId,
        tableId,
        session: {
          status: 'active',
          expiresAt: { gt: new Date() },
          deletedAt: null,
        },
        status: {
          in: [
            'pending_payment',
            'pending_acceptance',
            'preparing',
            'refunding',
          ],
        },
      },
    });
    if (blockingOrderCount > 0) {
      throw new ConflictException(
        '当前会话仍有待付款、待接单、制作中或退款中的订单，无法清桌',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.scanOrderingCartItem.updateMany({
        where: { session: { storeId, tableId }, status: 'active' },
        data: { status: 'removed' },
      });
      await tx.scanOrderingSession.updateMany({
        where: { storeId, tableId, status: 'active' },
        data: { status: 'checked_out' },
      });
      await tx.scanOrderingTable.update({
        where: { id: tableId },
        data: { status: 'empty', version: { increment: 1 } },
      });
    });
  }

  async listTables(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingTableResponse[]> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:view',
    );

    const tables = await this.prisma.scanOrderingTable.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ areaId: 'asc' }, { tableCode: 'asc' }, { id: 'asc' }],
      include: {
        area: { select: { name: true } },
        type: { select: { name: true } },
        sessions: {
          where: { status: 'active', expiresAt: { gt: new Date() } },
          orderBy: [{ lastActiveAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            createdAt: true,
            guestCount: true,
            status: true,
            orders: {
              where: {
                status: {
                  in: [
                    'pending_payment',
                    'pending_acceptance',
                    'preparing',
                    'served',
                    'refunding',
                  ],
                },
              },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                orderNo: true,
                status: true,
                paymentStatus: true,
                fulfillmentStatus: true,
                payableAmount: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return tables.map((table) => {
      const activeSession = table.sessions[0] ?? null;
      const activeOrders = table.sessions.flatMap((session) => session.orders);
      const guestCount = table.sessions.reduce(
        (total, session) => total + session.guestCount,
        0,
      );
      const isOccupied = activeSession !== null;

      return {
        id: table.id,
        tableCode: table.tableCode,
        name: table.name,
        status:
          table.status === 'disabled'
            ? 'disabled'
            : isOccupied
              ? 'dining'
              : 'empty',
        activeOrderCount: isOccupied ? activeOrders.length : 0,
        guestCount: isOccupied ? guestCount : 0,
        activeSession: isOccupied
          ? {
              id: activeSession.id,
              startedAt: activeSession.createdAt.toISOString(),
              guestCount,
              status: activeSession.status,
            }
          : null,
        activeOrders: activeOrders.map((order) => ({
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          totalAmount: order.payableAmount,
          createdAt: order.createdAt.toISOString(),
        })),
        areaId: table.areaId,
        areaName: table.area?.name ?? null,
        typeId: table.typeId,
        typeName: table.type?.name ?? null,
      };
    });
  }

  private async resolveEnabledStoreId(
    user: AuthenticatedUser,
    permission: 'scan-ordering:view' | 'scan-ordering:table-manage',
  ): Promise<number> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权操作扫码点餐桌台',
    );
    return storeId;
  }
}
