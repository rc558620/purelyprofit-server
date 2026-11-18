import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import type { PermissionCode } from '../../purely-profit/access-control/access-control.constants';
import { CommerceAccessService } from '../../purely-profit/commerce/commerce-access.service';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingSocketAuthService } from './scan-ordering-socket-auth.service';
import type {
  JoinOrderPayload,
  JoinRoomResult,
  JoinSessionPayload,
  JoinStorePayload,
  JoinStoreRoomResult,
  JoinVoucherOrderPayload,
} from './scan-ordering-socket.types';

/** 门店维度房间订阅的权限口径（订阅事件、权限集、拒绝文案）。 */
interface StoreRoomSubscriptionSpec {
  event: string;
  storeId: number;
  permissions: readonly PermissionCode[];
  forbiddenMessage: string;
}

/**
 * 扫码点餐 Socket 房间订阅：归属校验 + 门店权限校验 + 入房。
 * gateway 只保留 `@SubscribeMessage` 装饰器与协议类型，业务判定收敛在此。
 */
@Injectable()
export class ScanOrderingSubscriptionService {
  private readonly logger = new Logger(ScanOrderingSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly socketAuthService: ScanOrderingSocketAuthService,
  ) {}

  /** C 端会员订阅自己的扫码点餐订单。 */
  async subscribeOrder(
    client: Socket,
    payload: JoinOrderPayload,
  ): Promise<JoinRoomResult> {
    const identity = this.socketAuthService.identityOf(client);
    this.logger.debug(
      `subscribe.order requested: socketId=${client.id}, userId=${identity.userId}, orderId=${payload.orderId}`,
    );
    const order = await this.prisma.scanOrders.findFirst({
      where: {
        id: payload.orderId,
        clubUserId: identity.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!order)
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_ORDER_SUBSCRIBE_FORBIDDEN,
          '无权订阅该订单',
        ),
      );
    const room = this.realtimeService.orderRoom(order.id);
    await this.joinRoom(client, 'subscribe.order', room);
    return { room };
  }

  /** C 端会员订阅自己的点餐会话。 */
  async subscribeSession(
    client: Socket,
    payload: JoinSessionPayload,
  ): Promise<JoinRoomResult> {
    const identity = this.socketAuthService.identityOf(client);
    this.logger.debug(
      `subscribe.session requested: socketId=${client.id}, userId=${identity.userId}, sessionId=${payload.sessionId}`,
    );
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: payload.sessionId,
        clubUserId: identity.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!session)
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_SESSION_SUBSCRIBE_FORBIDDEN,
          '无权订阅该点餐会话',
        ),
      );
    const room = this.realtimeService.sessionRoom(session.id);
    await this.joinRoom(client, 'subscribe.session', room);
    return { room };
  }

  /** C 端会员订阅自己的团购券订单核销/退款状态。 */
  async subscribeVoucherOrder(
    client: Socket,
    payload: JoinVoucherOrderPayload,
  ): Promise<JoinRoomResult> {
    const identity = this.socketAuthService.identityOf(client);
    this.logger.debug(
      `subscribe.voucher-order requested: socketId=${client.id}, userId=${identity.userId}, orderNo=${payload.orderNo}`,
    );
    // 与 subscribe.order 对齐：强制归属校验，
    // 否则任何登录用户凭 orderNo 即可订阅他人团购券订单的核销/退款实时状态。
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: {
        orderNo: payload.orderNo,
        userId: identity.userId,
      },
      select: { orderNo: true },
    });
    if (!order)
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_VOUCHER_SUBSCRIBE_FORBIDDEN,
          '该团购券订单不存在',
        ),
      );
    const room = this.realtimeService.voucherOrderRoom(payload.orderNo);
    await this.joinRoom(client, 'subscribe.voucher-order', room);
    return { room };
  }

  /** 商家端订阅门店团购券订单房间。 */
  async subscribeVoucherStore(
    client: Socket,
    payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    // 团购券订单实时订阅：能查看/处理团购券订单（space:view 或 operation-entry:create）即可订阅，
    // 兼容餐饮店长（无 space:view 但有 operation-entry:create 可确认/拒绝团购券订单）
    await this.assertStoreSubscribable(client, {
      event: 'subscribe.voucher-store',
      storeId: payload.storeId,
      permissions: ['space:view', 'operation-entry:create'],
      forbiddenMessage: '无权订阅该门店团购券订单',
    });
    const room = this.realtimeService.voucherOrderStoreRoom(payload.storeId);
    await this.joinRoom(client, 'subscribe.voucher-store', room);
    return { room, storeId: payload.storeId };
  }

  /** 商家端订阅扫码点餐门店房间。 */
  async subscribeStore(
    client: Socket,
    payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    await this.assertStoreSubscribable(client, {
      event: 'subscribe.store',
      storeId: payload.storeId,
      permissions: ['scan-ordering:view', 'scan-ordering:order-process'],
      forbiddenMessage: '无权订阅该门店',
    });
    const room = this.realtimeService.storeRoom(payload.storeId);
    await this.joinRoom(client, 'subscribe.store', room);
    return { room, storeId: payload.storeId };
  }

  /** 自助下单门店房间订阅（purelyProfit 商家端新订单弹窗），权限与扫码点餐分开 */
  async subscribeSelfOrderingStore(
    client: Socket,
    payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    await this.assertStoreSubscribable(client, {
      event: 'subscribe.self-ordering-store',
      storeId: payload.storeId,
      permissions: ['self-ordering:view', 'self-ordering:order-process'],
      forbiddenMessage: '无权订阅该门店',
    });
    const room = this.realtimeService.selfOrderingStoreRoom(payload.storeId);
    await this.joinRoom(client, 'subscribe.self-ordering-store', room);
    return { room, storeId: payload.storeId };
  }

  /** 空间管理门店房间订阅（结账完成广播，商家端空间管理页实时刷新房态） */
  async subscribeSpaceStore(
    client: Socket,
    payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    await this.assertStoreSubscribable(client, {
      event: 'subscribe.space-store',
      storeId: payload.storeId,
      permissions: ['space:view'],
      forbiddenMessage: '无权订阅该门店空间状态',
    });
    const room = this.realtimeService.spaceStoreRoom(payload.storeId);
    await this.joinRoom(client, 'subscribe.space-store', room);
    return { room, storeId: payload.storeId };
  }

  /** 门店维度订阅统一权限校验，失败时保留可定位的审计日志。 */
  private async assertStoreSubscribable(
    client: Socket,
    spec: StoreRoomSubscriptionSpec,
  ): Promise<void> {
    const identity = this.socketAuthService.identityOf(client);
    this.logger.debug(
      `${spec.event} requested: socketId=${client.id}, userId=${identity.userId}, storeId=${spec.storeId}`,
    );
    try {
      await this.commerceAccessService.ensureCanAccessStoreWithAnyPermission(
        this.socketAuthService.toAuthenticatedUser(identity),
        spec.storeId,
        spec.permissions,
        spec.forbiddenMessage,
      );
    } catch (error) {
      this.logger.error(
        `${spec.event} failed: socketId=${client.id}, userId=${identity.userId}, storeId=${spec.storeId}, membership=${JSON.stringify(identity.currentMembership)}, error=${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async joinRoom(
    client: Socket,
    event: string,
    room: string,
  ): Promise<void> {
    await client.join(room);
    this.logger.debug(`${event} joined: socketId=${client.id}, room=${room}`);
  }
}
