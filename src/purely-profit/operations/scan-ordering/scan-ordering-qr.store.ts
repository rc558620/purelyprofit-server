import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import type { ScanOrderingQrTokenSecrets } from '../../../shared/scan-ordering-qr-token-codec.utils';
import type {
  ScanOrderingQrCodeExportItem,
  ScanOrderingQrCodeListItem,
} from './scan-ordering-qr.types';

/** 桌码列表缓存时长（秒）：列表只在轮换 / 作废后失效，读远多于写。 */
const QR_CODE_LIST_CACHE_TTL_SECONDS = 300;

/** 新写入的桌码记录的最小投影。 */
export interface CreatedQrCodeRow {
  id: number;
  version: number;
}

/** 建码要落库的 token 派生数据（密文必存在，否则商家端无法重新出图）。 */
export type QrTokenSecretColumns = Required<ScanOrderingQrTokenSecrets>;

/** 当前有效桌码的最小投影。 */
export interface ActiveQrCodeRow {
  id: number;
  version: number;
  tokenCiphertext: string | null;
}

/** 版本化写入桌码的入参。 */
export interface CreateQrCodeVersionParams {
  storeId: number;
  tableId: number;
  secrets: QrTokenSecretColumns;
  /** 是否先作废该桌台的 active 桌码（轮换为 true，首次建码为 false）。 */
  revokeCurrentCode: boolean;
}

/**
 * 扫码点餐桌码持久化存储：Prisma 读写 + 列表缓存。
 *
 * 单独抽出的原因：主 service 只负责「权限校验 → 编排 → 出图」，
 * 桌码表结构细节、事务内取版本号、缓存 key 与 TTL 都属于存取层，
 * 混在一起会让任何一处 SQL 调整都要动编排代码。
 */
@Injectable()
export class ScanOrderingQrStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /** 桌台是否属于该门店且未删除。 */
  async existsTable(storeId: number, tableId: number): Promise<boolean> {
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: tableId, storeId, deletedAt: null },
      select: { id: true },
    });
    return Boolean(table);
  }

  /** 读取该桌台的当前有效桌码（含密文，用于重新出图）。 */
  findActiveQrCode(
    storeId: number,
    tableId: number,
  ): Promise<ActiveQrCodeRow | null> {
    return this.prisma.scanOrderingTableQrCode.findFirst({
      where: { storeId, tableId, status: 'active' },
      select: { id: true, version: true, tokenCiphertext: true },
    });
  }

  /** 读取桌码版本列表，命中缓存直接返回。 */
  async listQrCodes(
    storeId: number,
    tableId: number,
  ): Promise<ScanOrderingQrCodeListItem[]> {
    const cacheKey = this.buildListCacheKey(storeId, tableId);
    const cachedCodes =
      await this.redisService.getJson<ScanOrderingQrCodeListItem[]>(cacheKey);
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
    await this.redisService.set(
      cacheKey,
      JSON.stringify(response),
      QR_CODE_LIST_CACHE_TTL_SECONDS,
    );
    return response;
  }

  /** 作废指定有效桌码，返回是否命中（并发重复作废时为 false）。 */
  async revokeQrCode(
    storeId: number,
    tableId: number,
    qrCodeId: number,
  ): Promise<boolean> {
    const result = await this.prisma.scanOrderingTableQrCode.updateMany({
      where: { id: qrCodeId, tableId, storeId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    return result.count > 0;
  }

  /** 按「桌台 + 版本」铺平该门店全部桌码，供批量导出。 */
  async listExportItems(
    storeId: number,
  ): Promise<ScanOrderingQrCodeExportItem[]> {
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

  /**
   * 版本化写入桌码：并发建码会撞「同版本」唯一约束，
   * 这里先作废残留 active 行再重试一次。
   *
   * 不能让冲突冒泡成 500 —— 商家端点「轮换」失败会以为操作没生效。
   */
  async createNextVersion(
    params: CreateQrCodeVersionParams,
  ): Promise<CreatedQrCodeRow> {
    try {
      return await this.insertNextVersion(params);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      await this.revokeActiveQrCodes(params.tableId);
      return this.insertNextVersion({ ...params, revokeCurrentCode: false });
    }
  }

  /** 清空该桌台列表缓存（轮换 / 作废后调用）。 */
  async invalidateListCache(storeId: number, tableId: number): Promise<void> {
    await this.redisService.del(this.buildListCacheKey(storeId, tableId));
  }

  /**
   * 在单个事务内作废旧码（可选）并写入下一版本桌码。
   *
   * 作废与取版本号必须在同一事务里：否则并发轮换会算出同一个 version，
   * 后写的一行撞唯一约束。
   */
  private insertNextVersion(
    params: CreateQrCodeVersionParams,
  ): Promise<CreatedQrCodeRow> {
    return this.prisma.$transaction(async (tx) => {
      if (params.revokeCurrentCode) {
        await tx.scanOrderingTableQrCode.updateMany({
          where: { tableId: params.tableId, status: 'active' },
          data: { status: 'revoked', revokedAt: new Date() },
        });
      }
      const latestQrCode = await tx.scanOrderingTableQrCode.findFirst({
        where: { tableId: params.tableId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.scanOrderingTableQrCode.create({
        data: {
          storeId: params.storeId,
          tableId: params.tableId,
          tokenHash: params.secrets.tokenHash,
          tokenCiphertext: params.secrets.tokenCiphertext,
          tokenPrefix: params.secrets.tokenPrefix,
          version: (latestQrCode?.version ?? 0) + 1,
        },
        select: { id: true, version: true },
      });
    });
  }

  private async revokeActiveQrCodes(tableId: number): Promise<void> {
    await this.prisma.scanOrderingTableQrCode.updateMany({
      where: { tableId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
  }

  private buildListCacheKey(storeId: number, tableId: number): string {
    return `scan-ordering:qr-codes:${storeId}:${tableId}`;
  }
}

/** 判断是否命中唯一约束冲突（并发轮换 / 补码会撞同一版本行）。 */
function isUniqueConstraintError(error: unknown): boolean {
  const { message, code } = (error ?? {}) as {
    message?: string;
    code?: string;
  };
  return Boolean(message?.includes('Unique constraint') || code === 'P2002');
}
