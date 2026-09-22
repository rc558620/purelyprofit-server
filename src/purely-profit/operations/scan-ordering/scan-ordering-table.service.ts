import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CreateScanOrderingTableDto,
  UpdateScanOrderingTableDto,
} from './dto/scan-ordering-table.dto';
import { ScanOrderingQrService } from './scan-ordering-qr.service';
import { ScanOrderingTableQueryService } from './scan-ordering-table-query.service';
import { ScanOrderingTableClearService } from './scan-ordering-table-clear.service';
import type {
  ScanOrderingCreatedTableResponse,
  ScanOrderingTableResponse,
} from './scan-ordering-table.types';

/** 桌台写操作所需权限。 */
type TableWritePermission =
  | 'scan-ordering:view'
  | 'scan-ordering:table-manage'
  | 'scan-ordering:table-config';

/** 商家扫码点餐桌台服务：桌台增删改查，列表查询与清桌分别委托专用服务。 */
@Injectable()
export class ScanOrderingTableService {
  private readonly logger = new Logger(ScanOrderingTableService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly qrService: ScanOrderingQrService,
    private readonly tableQueryService: ScanOrderingTableQueryService,
    private readonly tableClearService: ScanOrderingTableClearService,
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
    const table = await this.createOrReviveTable(storeId, dto);
    const qrCode = await this.qrService.createInitialQrCode(storeId, table.id);

    return {
      id: table.id,
      tableCode: table.tableCode,
      name: table.name,
      status: table.status as ScanOrderingTableResponse['status'],
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

  /**
   * 创建桌台；同 store+tableCode 存在已禁用（软删除或停用）记录时复用该记录，
   * 避免历史桌码残留导致编号永久不可用。
   */
  private async createOrReviveTable(
    storeId: number,
    dto: CreateScanOrderingTableDto,
  ): Promise<{
    id: number;
    tableCode: string;
    name: string;
    status: string;
    areaId: number | null;
    typeId: number | null;
  }> {
    try {
      return await this.prisma.scanOrderingTable.create({
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
      if (
        error.message?.includes('Unique constraint') ||
        error.code === 'P2002' // Prisma 唯一约束错误码
      ) {
        return this.reviveDisabledTable(storeId, dto);
      }
      throw error;
    }
  }

  /** 激活同编号的已禁用桌台，并先吊销其旧二维码以避免生成首个桌码时冲突。 */
  private async reviveDisabledTable(
    storeId: number,
    dto: CreateScanOrderingTableDto,
  ): Promise<{
    id: number;
    tableCode: string;
    name: string;
    status: string;
    areaId: number | null;
    typeId: number | null;
  }> {
    this.logger.warn(
      `检测到桌台 ${storeId}/${dto.tableCode} 的唯一约束冲突，尝试复用已禁用记录`,
    );
    const disabledTable = await this.prisma.scanOrderingTable.findFirst({
      where: {
        storeId,
        tableCode: dto.tableCode,
        OR: [{ deletedAt: { not: null } }, { isActive: false }],
      },
    });
    if (!disabledTable) throw new ConflictException('桌台编号已存在');

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.scanOrderingTableQrCode.updateMany({
        where: { tableId: disabledTable.id, status: 'active' },
        data: { status: 'revoked', revokedAt: now },
      });
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

  clearTable(user: AuthenticatedUser, tableId: number): Promise<void> {
    return this.tableClearService.clearTable(user, tableId);
  }

  listTables(user: AuthenticatedUser): Promise<ScanOrderingTableResponse[]> {
    return this.tableQueryService.listTables(user);
  }

  private async resolveEnabledStoreId(
    user: AuthenticatedUser,
    permission: TableWritePermission,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权操作扫码点餐桌台',
    );
  }
}
