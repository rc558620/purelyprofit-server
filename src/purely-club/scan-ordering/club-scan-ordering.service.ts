import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubScanOrderingQrTokenService } from './club-scan-ordering-qr-token.service';
import { ClubScanOrderingSessionService } from './club-scan-ordering-session.service';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';
import { ClubScanOrderingServiceCallService } from './club-scan-ordering-service-call.service';
import type {
  CreateClubScanServiceCallDto,
  CreateClubScanSessionDto,
  UpdateClubScanSessionDto,
} from './dto/club-scan-ordering.dto';

/**
 * C 端扫码点餐门面。
 *
 * 本身不含业务逻辑，只把 Controller 的入口路由到具体实现：
 * - 桌码解析与一次性扫码凭据：ClubScanOrderingQrTokenService
 * - 桌台会话生命周期：ClubScanOrderingSessionService
 * - 菜单：ClubScanOrderingMenuQueryService
 * - 服务呼叫：ClubScanOrderingServiceCallService
 * 购物车与订单链路已各自独立（ClubScanOrderingCartService / ...OrderService）。
 */
@Injectable()
export class ClubScanOrderingService {
  constructor(
    private readonly qrTokenService: ClubScanOrderingQrTokenService,
    private readonly sessionService: ClubScanOrderingSessionService,
    private readonly menuQueryService: ClubScanOrderingMenuQueryService,
    private readonly serviceCallQueryService: ClubScanOrderingServiceCallService,
  ) {}

  resolveQrToken(qrToken: string): Promise<unknown> {
    return this.qrTokenService.resolveQrToken(qrToken);
  }

  createOrRestoreSession(
    user: AuthenticatedUser,
    dto: CreateClubScanSessionDto,
  ): Promise<unknown> {
    return this.sessionService.createOrRestoreSession(user, dto);
  }

  getCurrentSession(
    user: AuthenticatedUser,
    tableId?: number,
  ): Promise<unknown> {
    return this.sessionService.getCurrentSession(user, tableId);
  }

  updateCurrentSession(
    user: AuthenticatedUser,
    dto: UpdateClubScanSessionDto,
    tableId?: number,
  ): Promise<unknown> {
    return this.sessionService.updateCurrentSession(user, dto, tableId);
  }

  leaveCurrentSession(
    user: AuthenticatedUser,
    tableId?: number,
  ): Promise<void> {
    return this.sessionService.leaveCurrentSession(user, tableId);
  }

  getMenu(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    return this.menuQueryService.getMenu(user, sessionId);
  }

  createServiceCall(
    user: AuthenticatedUser,
    dto: CreateClubScanServiceCallDto,
  ): Promise<unknown> {
    return this.serviceCallQueryService.createServiceCall(user, dto);
  }
}
