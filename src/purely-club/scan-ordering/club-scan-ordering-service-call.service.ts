import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ServiceCallType } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubServiceCallService } from '../service-call/club-service-call.service';
import type { CreateClubScanServiceCallDto } from './dto/club-scan-ordering.dto';

@Injectable()
export class ClubScanOrderingServiceCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceCallService: ClubServiceCallService,
  ) {}

  async createServiceCall(
    user: AuthenticatedUser,
    dto: CreateClubScanServiceCallDto,
  ): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: dto.sessionId,
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
        type: { select: { name: true } },
      },
    });
    const locationLabel = [table?.area?.name, table?.type?.name, table?.name]
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
}
