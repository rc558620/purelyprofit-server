import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScanOrderServiceCallStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
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
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  async list(user: AuthenticatedUser, dto: ListScanOrderingServiceCallsDto) {
    const storeId = await this.resolveStoreId(user, 'scan-ordering:view');
    return this.prisma.scanOrderServiceCall.findMany({
      where: { storeId, ...(dto.status ? { status: dto.status } : {}) },
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
      include: { table: { select: { id: true, name: true, tableCode: true } } },
    });
  }

  async process(
    user: AuthenticatedUser,
    serviceCallId: number,
    dto: ProcessScanOrderingServiceCallDto,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:order-process',
    );
    const current = await this.prisma.scanOrderServiceCall.findFirst({
      where: { id: serviceCallId, storeId },
      select: { id: true, sessionId: true, status: true },
    });
    if (!current) throw new NotFoundException('服务呼叫不存在');
    if (current.status === ScanOrderServiceCallStatus.resolved) {
      throw new ConflictException('服务呼叫已处理完成');
    }
    if (
      dto.status === 'acknowledged' &&
      current.status !== ScanOrderServiceCallStatus.pending
    ) {
      throw new ConflictException('当前服务呼叫不可确认响应');
    }
    const nextStatus =
      dto.status === 'acknowledged'
        ? ScanOrderServiceCallStatus.acknowledged
        : ScanOrderServiceCallStatus.resolved;
    await this.prisma.scanOrderServiceCall.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        ...(nextStatus === ScanOrderServiceCallStatus.acknowledged
          ? { acknowledgedAt: new Date() }
          : { resolvedAt: new Date() }),
        ...(dto.remark ? { remark: dto.remark } : {}),
      },
    });
    this.realtimeService.publishServiceCallUpdated({
      storeId,
      sessionId: current.sessionId,
      serviceCallId: current.id,
      status: nextStatus,
    });
  }

  private resolveStoreId(
    user: AuthenticatedUser,
    permission: 'scan-ordering:view' | 'scan-ordering:order-process',
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权处理扫码点餐服务呼叫',
    );
  }
}
