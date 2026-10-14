import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubScanOrderingQrTokenService } from './club-scan-ordering-qr-token.service';
import type {
  CreateClubScanSessionDto,
  UpdateClubScanSessionDto,
} from './dto/club-scan-ordering.dto';

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** 会话响应里的桌台快照；区域 / 桌型按查询口径可选。 */
interface SessionTableSnapshot {
  id: number;
  tableCode: string;
  name: string;
  capacity: number;
  status: string;
  area?: { name: string } | null;
  type?: { name: string } | null;
}

interface SessionRecord {
  id: number;
  guestCount: number;
  status: string;
  expiresAt: Date;
}

/**
 * 扫码点餐桌台会话的生命周期（建立 / 恢复 / 查询 / 更新 / 离桌）。
 *
 * 会话以 (storeId, tableId, clubUserId) 为边界，购物车挂在 sessionId 上，
 * 所以每次拿新凭据进桌台都必须是新会话，不能复用上次未结算的会话。
 */
@Injectable()
export class ClubScanOrderingSessionService {
  private readonly logger = new Logger(ClubScanOrderingSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qrTokenService: ClubScanOrderingQrTokenService,
    private readonly storeAccessService: ClubStoreAccessService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  async createOrRestoreSession(
    user: AuthenticatedUser,
    dto: CreateClubScanSessionDto,
  ): Promise<unknown> {
    const scanContext = await this.qrTokenService.consumeScanToken(
      dto.scanToken,
    );
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

    // 桌码进店即入店：把「当前门店」切到桌台所属门店。
    //
    // 此前桌码链路只补会员关系、不切门店（只有门店邀请码路径会切），于是
    // 「当前门店是 B、桌台会话在 A」成了常态错配，带来两个后果：
    // - 点餐历史按当前门店过滤（ClubScanOrderingOrderHistoryService），
    //   扫 A 店桌码下的单在 B 店永远看不到；
    // - 下单时无从做门店一致性校验——拿当前门店比对必然误伤正常扫码。
    // 切门店后两者恒等，「到店即入店」与门店邀请码路径语义一致。
    // 必须在 ensureStoreMembership 之后：切换前会按 Member 关系校验可访问性，
    // 会员关系还没建立时会查不到这家店。
    await this.currentStoreContextService.switchCurrentStore(
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

  async getCurrentSession(
    user: AuthenticatedUser,
    tableId?: number,
  ): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        status: 'active',
        deletedAt: null,
        // 指定桌台时只看该桌台的会话：默认口径（用户最近活跃的会话）在用户同时开着
        // 多桌台会话时（例如先在 A01 下单，再回到 A02）会把 A02 的有效会话判成失效。
        ...(tableId ? { tableId } : {}),
        OR: [
          { expiresAt: { gt: new Date() } },
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
    tableId?: number,
  ): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
        // 与 getCurrentSession 同口径：指定桌台时只改该桌台的会话。
        // 用户可能同时持有多个桌台会话（先在 A01 下单、再扫 A02），
        // 不限定桌台会把人数改到另一桌的会话上。
        ...(tableId ? { tableId } : {}),
      },
      // findFirst 无 orderBy 时返回顺序不确定，多会话下会随机命中一个
      orderBy: { lastActiveAt: 'desc' },
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

  async leaveCurrentSession(
    user: AuthenticatedUser,
    tableId?: number,
  ): Promise<void> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
        // 同 updateCurrentSession：不限定桌台会误退到另一桌的会话
        ...(tableId ? { tableId } : {}),
      },
      orderBy: { lastActiveAt: 'desc' },
    });
    if (!session) throw new ConflictException('不存在有效点餐会话');
    await this.prisma.scanOrderingSession.update({
      where: { id: session.id },
      data: { status: 'left', deletedAt: new Date() },
    });
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
  ): Promise<SessionRecord & { diningRoundId: string }> {
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
    const data = {
      storeId,
      tableId,
      clubUserId,
      diningRoundId,
      session: randomBytes(24).toString('base64url'),
      guestCount: guestCount ?? 1,
      expiresAt,
      lastActiveAt: now,
    };
    try {
      return await this.prisma.scanOrderingSession.create({ data });
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
            ...data,
            session: randomBytes(24).toString('base64url'),
          },
        });
      }
      throw error;
    }
  }

  private toSessionResponse(
    session: SessionRecord,
    table: SessionTableSnapshot,
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
