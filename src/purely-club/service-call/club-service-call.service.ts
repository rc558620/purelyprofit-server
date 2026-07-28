import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ServiceCallType } from '@prisma/client';
import { CreateClubServiceCallDto } from './dto/create-club-service-call.dto';
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

  async createFromHome(user: AuthenticatedUser, dto: CreateClubServiceCallDto) {
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
