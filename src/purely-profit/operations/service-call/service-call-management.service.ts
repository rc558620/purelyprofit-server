import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ServiceCallStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ServiceCallRealtimeService } from '../../../purely-club/service-call/service-call-realtime.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';

const PROCESSING_SERVICE_CALL_TTL_MS = 15 * 60_000;
const EXPIRY_CHECK_INTERVAL_MS = 60_000;

@Injectable()
export class ServiceCallManagementService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ServiceCallManagementService.name);
  private expiryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ServiceCallRealtimeService,
  ) {}

  onModuleInit(): void {
    this.expiryTimer = setInterval(() => {
      void this.expireOverdueCalls();
    }, EXPIRY_CHECK_INTERVAL_MS);
    void this.expireOverdueCalls();
  }

  onModuleDestroy(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = null;
  }

  async list(user: AuthenticatedUser, status?: ServiceCallStatus) {
    const storeId = await this.resolveStoreId(user, 'service-call:view');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const calls = await this.prisma.serviceCall.findMany({
      where: {
        storeId,
        requestedAt: { gte: todayStart },
        ...(status ? { status } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { reminderCount: 'desc' },
        { lastRequestedAt: 'asc' },
      ],
    });
    return calls.map((serviceCall) => ({
      ...serviceCall,
      requestedAt: serviceCall.requestedAt.toISOString(),
      lastRequestedAt: serviceCall.lastRequestedAt.toISOString(),
      processingStartedAt:
        serviceCall.processingStartedAt?.toISOString() ?? null,
      completedAt: serviceCall.completedAt?.toISOString() ?? null,
      cancelledAt: serviceCall.cancelledAt?.toISOString() ?? null,
      expiresAt: serviceCall.expiresAt.toISOString(),
      expiredAt: serviceCall.expiredAt?.toISOString() ?? null,
      createdAt: serviceCall.createdAt.toISOString(),
      updatedAt: serviceCall.updatedAt.toISOString(),
    }));
  }

  async process(
    user: AuthenticatedUser,
    serviceCallId: number,
    status: 'processing' | 'completed',
    remark?: string,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(user, 'service-call:process');
    const current = await this.prisma.serviceCall.findFirst({
      where: { id: serviceCallId, storeId },
    });
    if (!current) throw new NotFoundException('服务呼叫不存在');
    if (current.status === ServiceCallStatus.completed) {
      throw new ConflictException('服务呼叫已处理完成');
    }
    if (
      status === 'processing' &&
      current.status !== ServiceCallStatus.pending
    ) {
      throw new ConflictException('当前服务呼叫不可确认响应');
    }
    const serviceCall = await this.prisma.serviceCall.update({
      where: { id: current.id },
      data: {
        status,
        processedByUserId: user.id,
        ...(status === 'processing'
          ? {
              processingStartedAt: new Date(),
              expiresAt: new Date(Date.now() + PROCESSING_SERVICE_CALL_TTL_MS),
            }
          : { completedAt: new Date() }),
        ...(remark ? { remark } : {}),
      },
    });
    this.logger.log(
      `服务呼叫状态已更新，准备发布 service_call.updated: serviceCallId=${serviceCall.id}, status=${serviceCall.status}, clubUserId=${serviceCall.clubUserId}, storeId=${serviceCall.storeId}, pid=${process.pid}`,
    );
    this.realtimeService.publishUpdated({
      id: serviceCall.id,
      storeId: serviceCall.storeId,
      source: serviceCall.source,
      type: serviceCall.type,
      status: serviceCall.status,
      locationLabel: serviceCall.locationLabel,
      remark: serviceCall.remark,
      relatedOrderId: serviceCall.relatedOrderId,
      createdAt: serviceCall.createdAt.toISOString(),
      clubUserId: serviceCall.clubUserId,
    });
  }

  private async expireOverdueCalls(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.serviceCall.updateManyAndReturn({
      where: {
        status: {
          in: [ServiceCallStatus.pending, ServiceCallStatus.processing],
        },
        expiresAt: { lte: now },
      },
      data: { status: ServiceCallStatus.expired, expiredAt: now },
    });
    for (const serviceCall of expired) {
      this.realtimeService.publishUpdated({
        id: serviceCall.id,
        storeId: serviceCall.storeId,
        source: serviceCall.source,
        type: serviceCall.type,
        status: serviceCall.status,
        locationLabel: serviceCall.locationLabel,
        remark: serviceCall.remark,
        relatedOrderId: serviceCall.relatedOrderId,
        createdAt: serviceCall.createdAt.toISOString(),
        clubUserId: serviceCall.clubUserId,
      });
    }
  }

  private resolveStoreId(
    user: AuthenticatedUser,
    permission: 'service-call:view' | 'service-call:process',
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权访问服务呼叫工作台',
    );
  }
}
