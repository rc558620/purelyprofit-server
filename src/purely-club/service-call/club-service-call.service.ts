import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ServiceCall, ServiceCallType } from '@prisma/client';
import { CreateClubServiceCallDto } from './dto/create-club-service-call.dto';
import { CreateClubSpaceServiceCallDto } from './dto/create-club-space-service-call.dto';
import { ServiceCallRealtimeService } from './service-call-realtime.service';

const OPEN_SERVICE_CALL_STATUSES = ['pending', 'processing'] as const;
const SERVICE_CALL_COOLDOWN_MS = 60_000;
const PENDING_SERVICE_CALL_TTL_MS = 5 * 60_000;

@Injectable()
export class ClubServiceCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
    private readonly realtimeService: ServiceCallRealtimeService,
  ) {}

  async createFromHome(
    user: AuthenticatedUser,
    dto: CreateClubServiceCallDto,
  ): Promise<ServiceCall> {
    const currentContext =
      await this.currentStoreContextService.requireCurrentContext(
        user,
        dto.storeId,
      );
    const existingCall = await this.prisma.serviceCall.findFirst({
      where: {
        clubUserId: user.id,
        storeId: currentContext.store.id,
        type: dto.type,
        status: { in: [...OPEN_SERVICE_CALL_STATUSES] },
      },
      orderBy: { requestedAt: 'desc' },
    });

    if (existingCall) {
      const now = new Date();
      const canRemind =
        now.getTime() - existingCall.lastRequestedAt.getTime() >=
        SERVICE_CALL_COOLDOWN_MS;
      if (!canRemind)
        throw new ConflictException('已通知工作人员，请一分钟后再试');
      const serviceCall = await this.prisma.serviceCall.update({
        where: { id: existingCall.id },
        data: {
          reminderCount: { increment: 1 },
          lastRequestedAt: now,
          ...(dto.remark ? { remark: dto.remark } : {}),
        },
      });
      this.realtimeService.publishCreated({
        id: serviceCall.id,
        storeId: serviceCall.storeId,
        source: serviceCall.source,
        type: serviceCall.type,
        status: serviceCall.status,
        locationLabel: serviceCall.locationLabel,
        remark: serviceCall.remark,
        relatedOrderId: serviceCall.relatedOrderId,
        createdAt: serviceCall.createdAt.toISOString(),
        reminderCount: serviceCall.reminderCount,
      });
      return serviceCall;
    }

    const serviceCall = await this.prisma.serviceCall.create({
      data: {
        storeId: currentContext.store.id,
        clubUserId: user.id,
        source: 'club_home',
        type: dto.type,
        remark: dto.remark,
        expiresAt: new Date(Date.now() + PENDING_SERVICE_CALL_TTL_MS),
      },
    });
    this.realtimeService.publishCreated({
      id: serviceCall.id,
      storeId: serviceCall.storeId,
      source: serviceCall.source,
      type: serviceCall.type,
      status: serviceCall.status,
      locationLabel: serviceCall.locationLabel,
      remark: serviceCall.remark,
      relatedOrderId: serviceCall.relatedOrderId,
      createdAt: serviceCall.createdAt.toISOString(),
    });
    return serviceCall;
  }

  private async resolveActiveSpaceQrCode(spaceToken: string): Promise<{
    storeId: number;
    revokedAt: Date | null;
    space: {
      id: number;
      name: string;
      deletedAt: Date | null;
      zone: { name: string } | null;
      type: { name: string };
    };
  }> {
    const token = spaceToken.trim();
    if (!token) {
      throw new BadRequestException('二维码无效，请扫描空间二维码');
    }

    const qrCode = await this.prisma.spaceQrCode.findUnique({
      where: { token },
      select: {
        storeId: true,
        revokedAt: true,
        space: {
          select: {
            id: true,
            name: true,
            deletedAt: true,
            zone: { select: { name: true } },
            type: { select: { name: true } },
          },
        },
      },
    });
    if (!qrCode) {
      throw new NotFoundException('二维码无效，请扫描空间二维码');
    }
    if (qrCode.revokedAt) {
      throw new BadRequestException('该空间二维码已作废，请联系工作人员');
    }
    if (qrCode.space.deletedAt) {
      throw new NotFoundException('该空间已删除，请联系工作人员');
    }

    return qrCode;
  }

  private async findOpenServiceCall(
    clubUserId: number,
    storeId: number,
    type: ServiceCallType,
  ): Promise<ServiceCall | null> {
    return this.prisma.serviceCall.findFirst({
      where: {
        clubUserId,
        storeId,
        type,
        status: { in: [...OPEN_SERVICE_CALL_STATUSES] },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  private async remindExistingCall(
    existingCall: ServiceCall,
    remark?: string,
    location?: { spaceId: number; locationLabel: string },
  ): Promise<ServiceCall> {
    const now = new Date();
    const canRemind =
      now.getTime() - existingCall.lastRequestedAt.getTime() >=
      SERVICE_CALL_COOLDOWN_MS;
    if (!canRemind) {
      throw new ConflictException('已通知工作人员，请一分钟后再试');
    }

    const serviceCall = await this.prisma.serviceCall.update({
      where: { id: existingCall.id },
      data: {
        reminderCount: { increment: 1 },
        lastRequestedAt: now,
        ...(remark ? { remark } : {}),
        ...(existingCall.spaceId == null && location
          ? {
              spaceId: location.spaceId,
              locationLabel: location.locationLabel,
            }
          : {}),
      },
    });
    this.publishCreated(serviceCall);
    return serviceCall;
  }

  private publishCreated(serviceCall: ServiceCall): void {
    this.realtimeService.publishCreated({
      id: serviceCall.id,
      storeId: serviceCall.storeId,
      source: serviceCall.source,
      type: serviceCall.type,
      status: serviceCall.status,
      locationLabel: serviceCall.locationLabel,
      remark: serviceCall.remark,
      relatedOrderId: serviceCall.relatedOrderId,
      createdAt: serviceCall.createdAt.toISOString(),
      reminderCount: serviceCall.reminderCount,
    });
  }

  private buildSpaceLocationLabel(space: {
    name: string;
    zone: { name: string } | null;
    type: { name: string };
  }): string {
    return [space.zone?.name, space.type.name, space.name]
      .filter((value): value is string => Boolean(value))
      .join(' · ');
  }

  async createFromScannedSpace(
    user: AuthenticatedUser,
    dto: CreateClubSpaceServiceCallDto,
  ): Promise<ServiceCall> {
    const spaceQrCode = await this.resolveActiveSpaceQrCode(dto.spaceToken);
    const currentContext =
      await this.currentStoreContextService.requireCurrentContext(user);

    if (currentContext.store.businessMode === 'catering') {
      throw new ForbiddenException('餐饮门店请通过订单页呼叫服务员');
    }
    if (spaceQrCode.storeId !== currentContext.store.id) {
      throw new ForbiddenException('该二维码不属于当前门店');
    }

    const locationLabel = this.buildSpaceLocationLabel(spaceQrCode.space);
    const existingCall = await this.findOpenServiceCall(
      user.id,
      currentContext.store.id,
      dto.type,
    );
    if (existingCall) {
      return this.remindExistingCall(existingCall, dto.remark, {
        spaceId: spaceQrCode.space.id,
        locationLabel,
      });
    }

    const serviceCall = await this.prisma.serviceCall.create({
      data: {
        storeId: currentContext.store.id,
        clubUserId: user.id,
        source: 'club_home',
        type: dto.type,
        spaceId: spaceQrCode.space.id,
        locationLabel,
        remark: dto.remark,
        expiresAt: new Date(Date.now() + PENDING_SERVICE_CALL_TTL_MS),
      },
    });
    this.publishCreated(serviceCall);
    return serviceCall;
  }

  async createFromScanOrdering(params: {
    clubUserId: number;
    storeId: number;
    tableId: number;
    sessionId: number;
    type: ServiceCallType;
    remark?: string;
    locationLabel: string;
  }) {
    const existingCall = await this.prisma.serviceCall.findFirst({
      where: {
        clubUserId: params.clubUserId,
        storeId: params.storeId,
        type: params.type,
        status: { in: [...OPEN_SERVICE_CALL_STATUSES] },
      },
      orderBy: { requestedAt: 'desc' },
    });
    if (existingCall) {
      throw new ConflictException('已通知服务员，请一分钟后再试');
    }

    const serviceCall = await this.prisma.serviceCall.create({
      data: {
        storeId: params.storeId,
        clubUserId: params.clubUserId,
        source: 'scan_ordering',
        type: params.type,
        locationLabel: params.locationLabel,
        remark: params.remark,
        expiresAt: new Date(Date.now() + PENDING_SERVICE_CALL_TTL_MS),
      },
    });
    this.realtimeService.publishCreated({
      id: serviceCall.id,
      storeId: serviceCall.storeId,
      source: serviceCall.source,
      type: serviceCall.type,
      status: serviceCall.status,
      locationLabel: serviceCall.locationLabel,
      remark: serviceCall.remark,
      relatedOrderId: serviceCall.relatedOrderId,
      createdAt: serviceCall.createdAt.toISOString(),
    });
    return {
      serviceCall,
      tableId: params.tableId,
      sessionId: params.sessionId,
    };
  }
}
