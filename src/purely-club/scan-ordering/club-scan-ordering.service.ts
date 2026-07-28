import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ServiceCallType } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubServiceCallService } from '../service-call/club-service-call.service';
import type { CreateClubScanSessionDto } from './dto/club-scan-ordering.dto';
import type { UpdateClubScanSessionDto } from './dto/club-scan-ordering.dto';
import type { CreateClubScanServiceCallDto } from './dto/club-scan-ordering.dto';

const SCAN_TOKEN_PREFIX = 'club:scan-ordering:token:';
const SCAN_TOKEN_TTL_SECONDS = 5 * 60;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

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
    private readonly serviceCallService: ClubServiceCallService,
  ) {}

  async resolveQrToken(qrToken: string): Promise<unknown> {
    const tokenHash = this.hash(qrToken);
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    // 查找是否存在有效且未删除的会话
    const existing = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        tableId: table.id,
        status: 'active',
        expiresAt: { gt: now },
        deletedAt: null,
      },
      orderBy: { lastActiveAt: 'desc' },
    });

    const session = existing
      ? await this.prisma.scanOrderingSession.update({
          where: { id: existing.id },
          data: {
            guestCount: dto.guestCount ?? existing.guestCount,
            lastActiveAt: now,
            expiresAt,
          },
        })
      : await this.upsertSession(
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
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
      orderBy: { lastActiveAt: 'desc' },
      include: { table: { include: { area: { select: { name: true } } } } },
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
      include: { table: { include: { area: { select: { name: true } } } } },
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

  async getMenu(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });
    if (!session)
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
    const categories = await this.prisma.scanOrderingMenuCategory.findMany({
      where: { storeId: session.storeId, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        products: {
          where: { isActive: true, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            specGroups: {
              where: { isActive: true },
              include: {
                options: { where: { isActive: true }, orderBy: { id: 'asc' } },
              },
            },
          },
        },
      },
    });
    return {
      menuVersion: this.hash(
        JSON.stringify(categories.map((item) => [item.id, item.version])),
      ),
      categories,
    };
  }

  async createServiceCall(
    user: AuthenticatedUser,
    dto: CreateClubScanServiceCallDto,
  ): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });
    if (!session)
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
    if (!session.tableId) throw new ConflictException('点餐会话未绑定桌台');
    const table = await this.prisma.scanOrderingTable.findUnique({
      where: { id: session.tableId },
      select: {
        name: true,
        area: { select: { name: true } },
      },
    });
    const locationLabel = [table?.area?.name, table?.name]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(' · ');
    const result = await this.serviceCallService.createFromScanOrdering({
      clubUserId: user.id,
      storeId: session.storeId,
      tableId: session.tableId,
      sessionId: session.id,
      type: dto.type as ServiceCallType,
      remark: dto.remark,
      locationLabel,
    });
    return result.serviceCall;
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
  }> {
    try {
      return await this.prisma.scanOrderingSession.create({
        data: {
          storeId,
          tableId,
          clubUserId,
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
   * 合并上一次的访客数量和当前数量，取较大值。
   */
  private mergeGuestCounts(
    previousGuestCount: number | undefined,
    currentGuestCount: number,
  ): number {
    return Math.max(previousGuestCount ?? 1, currentGuestCount);
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
        capacity: table.capacity,
        status: table.status,
      },
    };
  }
}
