import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { extractTableQrToken } from '../shared/table-qr-token.utils';

const SCAN_TOKEN_PREFIX = 'club:scan-ordering:token:';
const SCAN_TOKEN_TTL_SECONDS = 5 * 60;

/** 一次性扫码凭据解析出的进店上下文。 */
export interface ResolvedScanToken {
  /** 门店 ID。 */
  storeId: number;
  /** 桌台 ID。 */
  tableId: number;
}

/**
 * 桌码解析与一次性扫码凭据（scan token）的签发 / 消费。
 *
 * scan token 是「解析桌码」与「建立会话」之间的一次性桥梁：解析阶段只做门店与
 * 桌台的合法性校验，真正的建会话必须拿凭据换，避免客户端绕过校验直接指定桌台。
 */
@Injectable()
export class ClubScanOrderingQrTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 解析桌码：校验业态与桌台状态后签发一次性 scan token。
   *
   * 返回体带上业态：桌码已强制 catering（见下方校验），前端据此同步 TabBar 等
   * 业态消费方，无需再为拿业态多发一次 /stores/current。
   */
  async resolveQrToken(qrToken: string): Promise<unknown> {
    const normalizedToken = extractTableQrToken(qrToken);
    const tokenHash = this.hash(normalizedToken);
    const qrCode = await this.prisma.scanOrderingTableQrCode.findFirst({
      where: {
        tokenHash,
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        table: { isActive: true, deletedAt: null },
      },
      select: {
        storeId: true,
        tableId: true,
        table: {
          select: {
            tableCode: true,
            name: true,
            capacity: true,
            status: true,
            area: { select: { name: true } },
          },
        },
      },
    });
    if (!qrCode) throw new NotFoundException('桌码无效，请重新扫码');

    // C 端扫码必须校验门店为餐饮业态，防止非餐饮门店通过历史脏数据或旧二维码被访问
    const store = await this.prisma.store.findUnique({
      where: { id: qrCode.storeId },
      select: { businessMode: true },
    });
    if (!store || store.businessMode !== 'catering') {
      throw new NotFoundException('桌码无效或门店不支持扫码点餐，请重新扫码');
    }
    if (
      qrCode.table.status === 'disabled' ||
      qrCode.table.status === 'clearing'
    ) {
      throw new ConflictException('当前桌台暂不可点餐');
    }

    const scanToken = await this.issueScanToken({
      storeId: qrCode.storeId,
      tableId: qrCode.tableId,
    });
    return {
      store: { id: qrCode.storeId, businessMode: store.businessMode },
      table: {
        id: qrCode.tableId,
        tableCode: qrCode.table.tableCode,
        name: qrCode.table.name,
        areaName: qrCode.table.area?.name ?? null,
        capacity: qrCode.table.capacity,
        status: qrCode.table.status,
        canOrder: true,
      },
      scanToken,
      expiresAt: new Date(
        Date.now() + SCAN_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  /**
   * 消费一次性 scan token：换取进店上下文后立即作废。
   *
   * 不删除会让同一凭据被重复用于建会话，等于把一次扫码变成可重放的入场券。
   */
  async consumeScanToken(scanToken: string): Promise<ResolvedScanToken> {
    const key = `${SCAN_TOKEN_PREFIX}${this.hash(scanToken)}`;
    const value = await this.redisService.get(key);
    if (!value)
      throw new BadRequestException('扫码凭据无效或已过期，请重新扫码');
    await this.redisService.del(key);
    return JSON.parse(value) as ResolvedScanToken;
  }

  /** 签发一次性凭据：Redis 只存 hash，凭据出现在日志 / 快照里也不能被反用。 */
  private async issueScanToken(context: ResolvedScanToken): Promise<string> {
    const scanToken = randomBytes(32).toString('base64url');
    await this.redisService.set(
      `${SCAN_TOKEN_PREFIX}${this.hash(scanToken)}`,
      JSON.stringify(context),
      SCAN_TOKEN_TTL_SECONDS,
    );
    return scanToken;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
