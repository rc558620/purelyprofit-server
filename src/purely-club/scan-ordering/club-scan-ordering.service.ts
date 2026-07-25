import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import type { CreateClubScanSessionDto } from './dto/club-scan-ordering.dto';
import type { UpdateClubScanSessionDto } from './dto/club-scan-ordering.dto';
import type { CreateClubScanServiceCallDto } from './dto/club-scan-ordering.dto';

const SCAN_TOKEN_PREFIX = 'club:scan-ordering:token:';
const SCAN_TOKEN_TTL_SECONDS = 5 * 60;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SERVICE_CALL_TTL_SECONDS = 120;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly realtimeService: ScanOrderingRealtimeService,
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
      : await this.prisma.scanOrderingSession.create({
          data: {
            storeId: scanContext.storeId,
            tableId: table.id,
            clubUserId: user.id,
            session: randomBytes(24).toString('base64url'),
            guestCount: dto.guestCount ?? 1,
            expiresAt,
            lastActiveAt: now,
          },
        });
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
    const key = `club:scan-ordering:service-call:${session.id}:${dto.type}`;
    if (await this.redisService.exists(key))
      throw new ConflictException('已通知服务员，请稍候');
    const result = await this.prisma.scanOrderServiceCall.create({
      data: {
        storeId: session.storeId,
        tableId: session.tableId,
        sessionId: session.id,
        clubUserId: user.id,
        callType: dto.type,
        remark: dto.remark,
      },
    });
    await this.redisService.set(key, '1', SERVICE_CALL_TTL_SECONDS);
    this.realtimeService.publishServiceCallCreated({
      storeId: result.storeId,
      sessionId: result.sessionId,
      serviceCallId: result.id,
      type: result.callType,
      remark: result.remark,
    });
    return result;
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
