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
    const existingTable = await this.prisma.scanOrderingTable.findFirst({
      where: { storeId, tableCode: dto.tableCode, deletedAt: null },
      select: { id: true },
    });

    if (existingTable) {
      throw new ConflictException('桌台编号已存在');
    }

    const table = await this.prisma.scanOrderingTable.create({
      data: {
        storeId,
        tableCode: dto.tableCode,
        name: dto.name,
        capacity: dto.capacity ?? 1,
        areaId: dto.areaId ?? null,
        typeId: dto.typeId ?? null,
      },
    });

    const qrCode = await this.qrService.createInitialQrCode(storeId, table.id);

    return {
      id: table.id,
      tableCode: table.tableCode,
      name: table.name,
      status: table.status,
      activeOrderCount: 0,
      guestCount: 0,
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
    const activeOrderCount = await this.prisma.scanOrders.count({
      where: {
        tableId,
        storeId,
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
    });
    if (activeOrderCount > 0)
      throw new ConflictException('桌台存在未完成订单，无法删除');
    const result = await this.prisma.scanOrderingTable.updateMany({
      where: { id: tableId, storeId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        isActive: false,
        status: 'disabled',
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new NotFoundException('扫码点餐桌台不存在');
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
    const activeOrderCount = await this.prisma.scanOrders.count({
      where: {
        tableId,
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
    });
    if (activeOrderCount > 0) {
      throw new ConflictException('桌台存在未完成订单，无法清桌');
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
          select: { guestCount: true },
          take: 1,
        },
        _count: {
          select: {
            orders: {
              where: {
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
        },
      },
    });

    return tables.map((table) => ({
      id: table.id,
      tableCode: table.tableCode,
      name: table.name,
      status: table.status,
      activeOrderCount: table._count.orders,
      guestCount: table.sessions[0]?.guestCount ?? 0,
      areaId: table.areaId,
      areaName: table.area?.name ?? null,
      typeId: table.typeId,
      typeName: table.type?.name ?? null,
    }));
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
