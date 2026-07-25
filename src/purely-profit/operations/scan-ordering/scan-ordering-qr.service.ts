import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 桌台二维码创建结果，明文 token 仅在本次创建响应返回。 */
export interface ScanOrderingQrCodeResponse {
  /** 二维码记录主键。 */
  id: number;
  /** 桌台主键。 */
  tableId: number;
  /** 桌码版本。 */
  version: number;
  /** 仅本次响应返回的不可枚举扫码 token。 */
  token: string;
  /** 二维码图片 Data URL（base64 PNG），可直接用于前端<img>标签。 */
  qrCodeImageUrl: string;
}

/** 桌台二维码服务常量。 */
const SCAN_ORDERING_QR_CODE_SIZE = 240;

/** 扫码点餐桌码管理服务。 */
@Injectable()
export class ScanOrderingQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async rotateQrCode(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权管理扫码点餐桌码',
    );
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: tableId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!table) {
      throw new NotFoundException('扫码点餐桌台不存在');
    }

    return this.createQrCode(storeId, tableId, true);
  }

  async listQrCodes(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<
    Array<{
      id: number;
      version: number;
      status: string;
      createdAt: string;
      revokedAt: string | null;
    }>
  > {
    const storeId = await this.requireTableStoreId(user, tableId);
    const cacheKey = this.buildQrCodeCacheKey(storeId, tableId);
    const cachedCodes = await this.redisService.getJson<
      Array<{
        id: number;
        version: number;
        status: string;
        createdAt: string;
        revokedAt: string | null;
      }>
    >(cacheKey);
    if (cachedCodes) return cachedCodes;

    const codes = await this.prisma.scanOrderingTableQrCode.findMany({
      where: { storeId, tableId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        createdAt: true,
        revokedAt: true,
      },
    });
    const response = codes.map((code) => ({
      ...code,
      createdAt: code.createdAt.toISOString(),
      revokedAt: code.revokedAt?.toISOString() ?? null,
    }));
    await this.redisService.set(cacheKey, JSON.stringify(response), 300);
    return response;
  }

  async revokeQrCode(
    user: AuthenticatedUser,
    tableId: number,
    qrCodeId: number,
  ): Promise<void> {
    const storeId = await this.requireTableStoreId(user, tableId);
    const result = await this.prisma.scanOrderingTableQrCode.updateMany({
      where: { id: qrCodeId, tableId, storeId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('有效桌码不存在');
    await this.invalidateQrCodeCache(storeId, tableId);
  }

  async exportQrCodes(user: AuthenticatedUser): Promise<
    Array<{
      tableId: number;
      tableCode: string;
      tableName: string;
      qrCodeVersion: number;
      qrCodeStatus: string;
    }>
  > {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权导出扫码点餐桌码',
    );
    const codes = await this.prisma.scanOrderingTableQrCode.findMany({
      where: { storeId },
      orderBy: [{ tableId: 'asc' }, { version: 'desc' }],
      select: {
        tableId: true,
        version: true,
        status: true,
        table: { select: { tableCode: true, name: true } },
      },
    });
    return codes.map((code) => ({
      tableId: code.tableId,
      tableCode: code.table.tableCode,
      tableName: code.table.name,
      qrCodeVersion: code.version,
      qrCodeStatus: code.status,
    }));
  }

  async createInitialQrCode(
    storeId: number,
    tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    return this.createQrCode(storeId, tableId, false);
  }

  private async requireTableStoreId(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<number> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权管理扫码点餐桌码',
    );
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: tableId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!table) throw new NotFoundException('扫码点餐桌台不存在');
    return storeId;
  }

  private async createQrCode(
    storeId: number,
    tableId: number,
    revokeCurrentCode: boolean,
  ): Promise<ScanOrderingQrCodeResponse> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const qrCode = await this.prisma.$transaction(async (tx) => {
      const latestQrCode = await tx.scanOrderingTableQrCode.findFirst({
        where: { tableId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (revokeCurrentCode) {
        await tx.scanOrderingTableQrCode.updateMany({
          where: { tableId, status: 'active' },
          data: { status: 'revoked', revokedAt: new Date() },
        });
      }
      const version = (latestQrCode?.version ?? 0) + 1;
      return tx.scanOrderingTableQrCode.create({
        data: { storeId, tableId, tokenHash, version },
        select: { id: true, version: true },
      });
    });

    await this.invalidateQrCodeCache(storeId, tableId);

    // 本地生成二维码图片 Data URL
    const qrCodeImageUrl = await QRCode.toDataURL(token, {
      width: SCAN_ORDERING_QR_CODE_SIZE,
      margin: 0,
      type: 'image/png',
    });

    return {
      id: qrCode.id,
      tableId,
      version: qrCode.version,
      token,
      qrCodeImageUrl,
    };
  }

  private buildQrCodeCacheKey(storeId: number, tableId: number): string {
    return `scan-ordering:qr-codes:${storeId}:${tableId}`;
  }

  private async invalidateQrCodeCache(
    storeId: number,
    tableId: number,
  ): Promise<void> {
    await this.redisService.del(this.buildQrCodeCacheKey(storeId, tableId));
  }
}
