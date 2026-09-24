import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';
import { ClubScanOrderingServiceCallService } from './club-scan-ordering-service-call.service';
import type { CreateClubScanSessionDto } from './dto/club-scan-ordering.dto';
import type { UpdateClubScanSessionDto } from './dto/club-scan-ordering.dto';
import type { CreateClubScanServiceCallDto } from './dto/club-scan-ordering.dto';

const SCAN_TOKEN_PREFIX = 'club:scan-ordering:token:';
const SCAN_TOKEN_TTL_SECONDS = 5 * 60;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * 桌码 token 形态：base64url，至少 16 位（服务端为 32 字节 base64url，43 位）。
 *
 * 必须与前端 `purelyClub/src/utils/scanPayload.ts` 的 `TABLE_TOKEN_PATTERN`
 * 保持一致（跨仓契约由 `scripts/check-scan-qr-path-contract.mjs` 兜底）。
 */
const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

interface ResolvedScanToken {
  /** 门店 ID。 */
  storeId: number;
  /** 桌台 ID。 */
  tableId: number;
}

/**
 * C 端扫码点餐服务（会话、桌台、菜单、服务呼叫）。
 *
 * 职责：
 * - QR token 解析与会话管理
 * - 菜单获取
 * - 服务呼叫创建
 * 购物车操作已提取至 ClubScanOrderingCartService。
 */
@Injectable()
export class ClubScanOrderingService {
  private readonly logger = new Logger(ClubScanOrderingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly menuQueryService: ClubScanOrderingMenuQueryService,
    private readonly serviceCallQueryService: ClubScanOrderingServiceCallService,
    private readonly storeAccessService: ClubStoreAccessService,
  ) {}

  async resolveQrToken(qrToken: string): Promise<unknown> {
    const normalizedToken = this.extractQrToken(qrToken);
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
    const scanToken = randomBytes(32).toString('base64url');
    await this.redisService.set(
      `${SCAN_TOKEN_PREFIX}${this.hash(scanToken)}`,
      JSON.stringify({ storeId: qrCode.storeId, tableId: qrCode.tableId }),
      SCAN_TOKEN_TTL_SECONDS,
    );
    return {
      store: { id: qrCode.storeId },
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

  async createOrRestoreSession(
    user: AuthenticatedUser,
    dto: CreateClubScanSessionDto,
  ): Promise<unknown> {
    const scanContext = await this.consumeScanToken(dto.scanToken);
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: {
        id: scanContext.tableId,
        storeId: scanContext.storeId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        tableCode: true,
        name: true,
        capacity: true,
        status: true,
        area: { select: { name: true } },
      },
    });
    if (!table || table.status === 'disabled' || table.status === 'clearing') {
      throw new ConflictException('当前桌台暂不可点餐');
    }

    // 到店消费即成为该门店会员：补齐 Member / MarketingCustomer 档案。
    // 缺少这一步会导致商家端看不到该顾客，且以「当前门店」为前提的接口
    // （/club/member/account、余额支付等）返回 404 —— findAccessibleStores
    // 是按 Member.phone 匹配门店的，桌码链路此前完全没建 Member。
    await this.storeAccessService.ensureStoreMembership(
      user,
      scanContext.storeId,
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    // 每次使用新的扫码凭据进入桌台都创建新的点餐会话。购物车以 sessionId 为边界，
    // 不能复用上次未结算会话，否则新一轮扫码会看到旧购物车条目。
    await this.prisma.scanOrderingSession.updateMany({
      where: {
        clubUserId: user.id,
        tableId: table.id,
        status: 'active',
        deletedAt: null,
      },
      data: { status: 'left', deletedAt: now, endedAt: now },
    });
    const session = await this.upsertSession(
      scanContext.storeId,
      table.id,
      user.id,
      dto.guestCount,
      expiresAt,
      now,
    );
    return this.toSessionResponse(session, table);
  }

  async getCurrentSession(user: AuthenticatedUser): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        status: 'active',
        deletedAt: null,
        OR: [
          { expiresAt: { gt: new Date() } },
          {
            orders: {
              some: {
                deletedAt: null,
                status: { in: ['pending_payment', 'pending_acceptance', 'preparing', 'served'] },
              },
            },
          },
        ],
      },
      orderBy: { lastActiveAt: 'desc' },
      include: {
        table: {
          include: {
            area: { select: { name: true } },
            type: { select: { name: true } },
          },
        },
      },
    });
    if (!session?.table) throw new NotFoundException('不存在有效点餐会话');
    return this.toSessionResponse(session, session.table);
  }

  async updateCurrentSession(
    user: AuthenticatedUser,
    dto: UpdateClubScanSessionDto,
  ): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
      include: { table: true },
    });
    if (!session) throw new ConflictException('不存在有效点餐会话');
    const updated = await this.prisma.scanOrderingSession.update({
      where: { id: session.id },
      data: { guestCount: dto.guestCount, lastActiveAt: new Date() },
      include: {
        table: {
          include: {
            area: { select: { name: true } },
            type: { select: { name: true } },
          },
        },
      },
    });
    if (!updated.table) throw new NotFoundException('桌台不存在');
    return this.toSessionResponse(updated, updated.table);
  }

  async leaveCurrentSession(user: AuthenticatedUser): Promise<void> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });
    if (!session) throw new ConflictException('不存在有效点餐会话');
    await this.prisma.scanOrderingSession.update({
      where: { id: session.id },
      data: { status: 'left', deletedAt: new Date() },
    });
  }

  getMenu(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    return this.menuQueryService.getMenu(user, sessionId);
  }

  createServiceCall(
    user: AuthenticatedUser,
    dto: CreateClubScanServiceCallDto,
  ): Promise<unknown> {
    return this.serviceCallQueryService.createServiceCall(user, dto);
  }

  private async consumeScanToken(
    scanToken: string,
  ): Promise<ResolvedScanToken> {
    const key = `${SCAN_TOKEN_PREFIX}${this.hash(scanToken)}`;
    const value = await this.redisService.get(key);
    if (!value)
      throw new BadRequestException('扫码凭据无效或已过期，请重新扫码');
    await this.redisService.del(key);
    const parsed = JSON.parse(value) as ResolvedScanToken;
    return parsed;
  }

  /**
   * 通过 upsert 创建或恢复会话，避免并发场景下的唯一键冲突。
   */
  private async upsertSession(
    storeId: number,
    tableId: number,
    clubUserId: number,
    guestCount: number | undefined,
    expiresAt: Date,
    now: Date,
  ): Promise<{
    id: number;
    guestCount: number;
    status: string;
    expiresAt: Date;
    diningRoundId: string;
  }> {
    const existingRound = await this.prisma.scanOrderingSession.findFirst({
      where: {
        storeId,
        tableId,
        clubUserId,
        status: { in: ['active', 'left'] },
        // 只允许复用最近 SESSION_TTL_MS 内的 diningRound，防止跨天/跨轮次复用
        // 导致旧会话的退款订单出现在新订单详情中——清桌后的旧会话不应再与当前用餐关联
        lastActiveAt: { gte: new Date(now.getTime() - SESSION_TTL_MS) },
      },
      orderBy: { lastActiveAt: 'desc' },
      select: { diningRoundId: true },
    });
    const diningRoundId = existingRound?.diningRoundId ?? randomUUID();
    try {
      return await this.prisma.scanOrderingSession.create({
        data: {
          storeId,
          tableId,
          clubUserId,
          diningRoundId,
          session: randomBytes(24).toString('base64url'),
          guestCount: guestCount ?? 1,
          expiresAt,
          lastActiveAt: now,
        },
      });
    } catch (error) {
      // 如果是因为唯一键冲突，说明有竞态条件，先清理可能存在的冲突记录
      if (
        error instanceof Error &&
        (error.message.includes('Unique constraint') ||
          error.message.includes('unique violation'))
      ) {
        this.logger.warn(
          '检测到会话创建的竞态条件，尝试清理后重新创建，user_id=%d, table_id=%d',
          clubUserId,
          tableId,
        );

        // 查找并标记可能冲突的会话为 left 状态
        await this.prisma.scanOrderingSession.updateMany({
          where: {
            clubUserId,
            tableId,
            status: 'active',
            deletedAt: null,
          },
          data: {
            status: 'left',
            deletedAt: now,
          },
        });

        // 重试创建新会话
        return await this.prisma.scanOrderingSession.create({
          data: {
            storeId,
            tableId,
            clubUserId,
            diningRoundId,
            session: randomBytes(24).toString('base64url'),
            guestCount: guestCount ?? 1,
            expiresAt,
            lastActiveAt: now,
          },
        });
      }
      throw error;
    }
  }

  /**
   * 从扫码内容中取桌码 token。
   *
   * 兼容三种形态，且对「前端已提取的裸 token」是幂等的（裸 token 不含 `/`）：
   *   1. query 式 URL：`{base}/t?token=xxx`
   *   2. 路径式 URL：`{base}/t/xxx`
   *   3. 历史裸 token：`xxx`
   *
   * ⚠️ 形态 2 必须在这里兜住：前端 `extractTableToken` 负责提取，但任何新入口
   * （H5、新增客户端、第三方对接）漏掉提取时，整条 URL 会被拿去 sha256 匹配，
   * 必然查不到并表现为「桌码无效，请重新扫码」——已印刷物料等于凭空失效。
   * 服务端与前端各提取一次，互为双保险。
   */
  private extractQrToken(rawValue: string): string {
    const value = rawValue.trim();
    if (!value) {
      return value;
    }

    // 形态 1：query 式 URL
    const fromQuery = this.readTokenQueryParam(value);
    if (fromQuery) {
      return fromQuery;
    }

    // 形态 2：路径式 URL（取末段，命中 token 形态才采用，避免把 `t` 当 token）
    const lastSegment = this.readLastPathSegment(value);
    if (TABLE_TOKEN_PATTERN.test(lastSegment)) {
      return lastSegment;
    }

    // 形态 3：历史裸 token
    return value;
  }

  /** 从 `?token=xxx` 中取值；非 URL 或无该参数时返回 null */
  private readTokenQueryParam(value: string): string | null {
    try {
      const token = new URL(value).searchParams.get('token')?.trim();
      return token || null;
    } catch {
      return null;
    }
  }

  /** 取路径末段：先剥离 scheme + host，再取最后一个非空分段 */
  private readLastPathSegment(value: string): string {
    const path = value.split(/[?#]/, 1)[0] ?? '';
    const withoutOrigin = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    const withoutScheme = withoutOrigin.replace(/^[a-z][a-z0-9+.-]*:/i, '');
    const segments = withoutScheme.split('/').filter(Boolean);
    return (segments[segments.length - 1] ?? '').trim();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private toSessionResponse(
    session: {
      id: number;
      guestCount: number;
      status: string;
      expiresAt: Date;
    },
    table: {
      id: number;
      tableCode: string;
      name: string;
      capacity: number;
      status: string;
      area?: { name: string } | null;
      type?: { name: string } | null;
    },
  ) {
    return {
      id: session.id,
      guestCount: session.guestCount,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      table: {
        id: table.id,
        tableCode: table.tableCode,
        name: table.name,
        areaName: table.area?.name ?? null,
        typeName: table.type?.name ?? null,
        capacity: table.capacity,
        status: table.status,
      },
    };
  }
}
