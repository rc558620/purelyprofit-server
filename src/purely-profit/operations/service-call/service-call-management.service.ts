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

// 临时联调：处理中超时设为 30 秒，待响应超时设为 60 秒，验证完成后恢复原值。
const PROCESSING_SERVICE_CALL_TTL_MS = 30_000;
const EXPIRY_CHECK_INTERVAL_MS = 1_000;

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
    const now = new Date();
    const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const startOfToday = new Date(`${shanghaiDate}T00:00:00+08:00`);
    const startOfTomorrow = new Date(
      startOfToday.getTime() + 24 * 60 * 60 * 1000,
    );
    const where = {
      storeId,
      createdAt: { gte: startOfToday, lt: startOfTomorrow },
      ...(status ? { status } : {}),
    };
    const calls = await this.prisma.serviceCall.findMany({
      where,
      orderBy: [{ lastRequestedAt: 'desc' }, { id: 'desc' }],
    });
    this.logger.log(
      `服务呼叫列表查询: storeId=${storeId}, status=${status ?? 'all'}, count=${calls.length}, ids=${calls.map((call) => `${call.id}:${call.status}`).join(',')}`,
    );
    return calls.map((serviceCall) => this.serializeServiceCall(serviceCall));
  }

  async process(
    user: AuthenticatedUser,
    serviceCallId: number,
    status: 'processing' | 'completed',
    remark?: string,
  ) {
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
    if (
      status === 'completed' &&
      current.status !== ServiceCallStatus.processing
    ) {
      throw new ConflictException('请先确认响应，再标记完成');
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
    return this.serializeServiceCall(serviceCall);
  }

  private serializeServiceCall(
    serviceCall: {
      requestedAt: Date;
      lastRequestedAt: Date;
      processingStartedAt: Date | null;
      completedAt: Date | null;
      cancelledAt: Date | null;
      expiresAt: Date;
      expiredAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    } & Record<string, unknown>,
  ) {
    return {
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
    };
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
