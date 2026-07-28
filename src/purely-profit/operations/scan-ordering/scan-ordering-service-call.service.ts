import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServiceCallStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ServiceCallRealtimeService } from '../../../purely-club/service-call/service-call-realtime.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  ListScanOrderingServiceCallsDto,
  ProcessScanOrderingServiceCallDto,
} from './dto/scan-ordering-service-call.dto';

@Injectable()
export class ScanOrderingServiceCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ServiceCallRealtimeService,
  ) {}

  async list(user: AuthenticatedUser, dto: ListScanOrderingServiceCallsDto) {
    const storeId = await this.resolveStoreId(user, 'service-call:view');
    return this.prisma.serviceCall.findMany({
      where: {
        storeId,
        source: 'scan_ordering',
        ...(dto.status ? { status: dto.status } : {}),
      },
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
    });
  }

  async process(
    user: AuthenticatedUser,
    serviceCallId: number,
    dto: ProcessScanOrderingServiceCallDto,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(user, 'service-call:process');
    const current = await this.prisma.serviceCall.findFirst({
      where: { id: serviceCallId, storeId, source: 'scan_ordering' },
    });
    if (!current) throw new NotFoundException('服务呼叫不存在');
    if (current.status === ServiceCallStatus.completed) {
      throw new ConflictException('服务呼叫已处理完成');
    }
    if (
      dto.status === 'acknowledged' &&
      current.status !== ServiceCallStatus.pending
    ) {
      throw new ConflictException('当前服务呼叫不可确认响应');
    }
    const status =
      dto.status === 'acknowledged'
        ? ServiceCallStatus.processing
        : ServiceCallStatus.completed;
    const updated = await this.prisma.serviceCall.update({
      where: { id: current.id },
      data: {
        status,
        ...(status === ServiceCallStatus.processing
          ? { processingStartedAt: new Date() }
          : { completedAt: new Date() }),
        processedByUserId: user.id,
        ...(dto.remark ? { remark: dto.remark } : {}),
      },
    });
    this.realtimeService.publishUpdated({
      id: updated.id,
      storeId: updated.storeId,
      source: updated.source,
      type: updated.type,
      status: updated.status,
      locationLabel: updated.locationLabel,
      remark: updated.remark,
      relatedOrderId: updated.relatedOrderId,
      createdAt: updated.createdAt.toISOString(),
    });
  }

  private resolveStoreId(
    user: AuthenticatedUser,
    permission: 'service-call:view' | 'service-call:process',
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权处理服务呼叫',
    );
  }
}
