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
import { ScanOrderingTableQueryService } from './scan-ordering-table-query.service';

/** 手工录入单轮次状态：清桌会话判定与前端 loadManualEntryOrders 口径一致
 * （含已完成，否则全部完结的手工单桌台会被误判为无轮次而无法清桌）。 */
const MANUAL_ENTRY_ROUND_STATUSES = [
  'pending_acceptance',
  'preparing',
  'served',
  'completed',
] as const;

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
    /** 会话标识：扫码会话为数字 ID；纯录入轮次为「manual-session-{桌台ID}」合成 ID */
    id: number | string;
    startedAt: string;
    guestCount: number;
    status: 'active' | 'checked_out' | 'expired' | 'left';
  } | null;
  /** 当前活跃会话中的进行中订单。 */
  activeOrders: Array<{
    /** 订单标识：扫码订单为数字 ID；手工补录单为「manual-{销售记录ID}」合成 ID */
    id: number | string;
    orderNo: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    totalAmount: number;
    createdAt: string;
    /** 是否为手工补录单（录入订单补账，无扫码订单详情，需跳销售记录查看） */
    manualEntry?: boolean;
  }>;
  /** 清桌校验结果。 */
  clearability: {
    canClear: boolean;
    blockingOrderCount: number;
    reason: string | null;
  };
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
    private readonly tableQueryService: ScanOrderingTableQueryService,
  ) {}

  async createTable(
    user: AuthenticatedUser,
    dto: CreateScanOrderingTableDto,
  ): Promise<ScanOrderingCreatedTableResponse> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:table-config',
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
      clearability: {
        canClear: false,
        blockingOrderCount: 0,
        reason: '当前为空桌',
      },
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
      'scan-ordering:table-config',
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
      'scan-ordering:table-config',
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
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const table = await tx.scanOrderingTable.findFirst({
        where: { id: tableId, storeId, deletedAt: null },
        select: { id: true },
      });
      if (!table) throw new NotFoundException('扫码点餐桌台不存在');
      // 有效 active 会话是当前用餐轮次的锚点；同桌 left 会话仅在该锚点存在时
      // 才属于本轮，避免历史遗留 left 会话重新占用已清空的桌台。
      const activeSessions = await tx.scanOrderingSession.findMany({
        where: {
          storeId,
          tableId,
          status: 'active',
          deletedAt: null,
          OR: [
            { expiresAt: { gt: now } },
            {
              orders: {
                some: {
                  deletedAt: null,
                  status: {
                    in: [
                      'pending_payment',
                      'pending_acceptance',
                      'preparing',
                      'served',
                    ],
                  },
                },
              },
            },
          ],
        },
        select: { id: true, diningRoundId: true },
      });
      // 手工录入单不挂扫码会话（sessionId=null），单独构成「录入轮次」：
      // 无有效扫码会话但存在手工单（含已完结）时同样允许清桌，避免手工单桌台清不掉。
      const manualEntryOrders = await tx.scanOrders.findMany({
        where: {
          storeId,
          tableId,
          manualEntry: true,
          deletedAt: null,
          status: { in: [...MANUAL_ENTRY_ROUND_STATUSES] },
        },
        select: { status: true },
      });
      if (activeSessions.length === 0 && manualEntryOrders.length === 0) {
        // 桌台可能残留离桌（left）会话：用户点单后未清桌即离开，会话已 left。
        // 若无任何 active 会话与手工单，但存在 left 会话，仍允许清桌归档，
        // 防止历史 left 会话长期残留并被新一轮扫码复用 diningRoundId，导致
        // 上一轮退款/历史订单重新出现在新订单详情中。
        const orphanLeftSessions = await tx.scanOrderingSession.count({
          where: { storeId, tableId, status: 'left' },
        });
        if (orphanLeftSessions === 0) {
          throw new ConflictException('当前桌台不存在有效用餐会话，无法清桌');
        }
      }
      const roundAnchorSessions =
        activeSessions.length > 0
          ? activeSessions
          : await tx.scanOrderingSession.findMany({
              where: { storeId, tableId, status: 'left' },
              select: { id: true, diningRoundId: true },
            });
      const diningRoundIds = roundAnchorSessions.map(
        (session) => session.diningRoundId,
      );
      // 有 active 会话时仅归档其所在轮次（同桌同轮 active+left）；
      // 仅剩遗留 left 会话时归档同桌全部 left 会话。
      const sessions =
        activeSessions.length > 0
          ? await tx.scanOrderingSession.findMany({
              where: {
                storeId,
                tableId,
                diningRoundId: { in: diningRoundIds },
                status: { in: ['active', 'left'] },
              },
              select: { id: true },
            })
          : await tx.scanOrderingSession.findMany({
              where: { storeId, tableId, status: 'left' },
              select: { id: true },
            });
      const orders = await tx.scanOrders.findMany({
        where: {
          sessionId: { in: sessions.map((session) => session.id) },
          deletedAt: null,
          // 已退款或退款处理中订单不再参与桌台履约；与桌台抽屉的可见订单
          // 保持同一范围，避免界面只显示已出餐却被隐藏退款单阻塞清桌。
          status: {
            notIn: ['rejected', 'cancelled', 'completed', 'refunding'],
          },
        },
        select: { status: true },
      });
      // 阻塞检查统一口径：扫码会话订单与手工单均按「未出餐即阻塞」计算（已完结不阻塞）
      const blockingOrderCount =
        orders.filter((order) => order.status !== 'served').length +
        manualEntryOrders.filter(
          (order) => order.status !== 'served' && order.status !== 'completed',
        ).length;
      if (blockingOrderCount > 0) {
        throw new ConflictException(
          `当前桌台仍有 ${blockingOrderCount} 笔订单未出餐，全部出餐后才可清桌`,
        );
      }
      await tx.scanOrderingCartItem.updateMany({
        where: {
          sessionId: { in: sessions.map((session) => session.id) },
          status: 'active',
        },
        data: { status: 'removed' },
      });
      await tx.scanOrderingSession.updateMany({
        where: {
          id: { in: sessions.map((session) => session.id) },
          status: { in: ['active', 'left'] },
        },
        data: { status: 'checked_out', endedAt: now, archiveReason: 'cleared' },
      });
      // 完结已出餐订单：扫码会话内订单 + 该桌手工单（手工单 sessionId=null，须单独更新）
      await tx.scanOrders.updateMany({
        where: {
          sessionId: { in: sessions.map((session) => session.id) },
          deletedAt: null,
          status: 'served',
        },
        data: { status: 'completed', completedAt: now },
      });
      await tx.scanOrders.updateMany({
        where: {
          storeId,
          tableId,
          manualEntry: true,
          deletedAt: null,
          status: 'served',
        },
        data: { status: 'completed', completedAt: now },
      });
      await tx.scanOrderingTable.update({
        where: { id: tableId },
        data: { status: 'empty', version: { increment: 1 } },
      });
    });
  }

  listTables(user: AuthenticatedUser): Promise<ScanOrderingTableResponse[]> {
    return this.tableQueryService.listTables(user);
  }

  private async resolveEnabledStoreId(
    user: AuthenticatedUser,
    permission:
      | 'scan-ordering:view'
      | 'scan-ordering:table-manage'
      | 'scan-ordering:table-config',
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
