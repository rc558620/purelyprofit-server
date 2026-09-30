// 客存 Socket.IO 网关：服务 B 端门店房间与 C 端 H5 会员房间。
//
// C 端微信小程序不能走 Socket.IO（见 scan-ordering-native-websocket.ts 注释），
// 走 `/api/ws/custody` 原生 WebSocket；本命名空间只用于 B 端与 C 端 H5，
// 两边共用同一份房间口径与 Redis 分发链路。
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAccessService } from '../../purely-profit/commerce/commerce-access.service';
import { AuthMembershipResolverService } from '../../purely-profit/auth/auth-membership-resolver.service';
import type { AuthenticatedMembership } from '../../purely-profit/access-control/access-control.service';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../purely-profit/auth/strategies/jwt.strategy';
import { resolveCustodyMemberId } from '../../shared/custody/custody-member.resolver';
import {
  CUSTODY_NAMESPACE,
  CustodyRealtimeService,
} from './custody-realtime.service';

interface SocketIdentity {
  userId: number;
  email: string;
  phone: string;
  currentMembership: AuthenticatedMembership | null;
}

interface JoinStorePayload {
  storeId: number;
}

interface SubscribeMemberResult {
  room: string;
  storeId: number;
  memberId: number;
}

@WebSocketGateway({
  namespace: CUSTODY_NAMESPACE,
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  cors: { origin: true, credentials: true },
})
export class CustodyGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(CustodyGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly realtimeService: CustodyRealtimeService,
  ) {}

  afterInit(server: Namespace): void {
    this.realtimeService.bindNamespace(server);
    server.use((client, next) => {
      void this.authenticateBeforeConnection(client, next);
    });
  }

  /**
   * 不自动入房：C 端房间键是「门店 + 手机号」定位出的 memberId，
   * 连接时还不知道门店，必须由客户端显式 subscribe。
   */
  handleConnection(client: Socket): void {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity) {
      client.disconnect(true);
      return;
    }
    this.logger.log(
      `custody socket connected: id=${client.id}, userId=${identity.userId}`,
    );
    client.on('disconnect', (reason) => {
      this.logger.log(
        `custody socket disconnected: id=${client.id}, userId=${identity.userId}, reason=${reason}`,
      );
    });
  }

  /** B 端订阅门店房间：与客存管理接口同权限口径 */
  @SubscribeMessage('subscribe.custody-store')
  async subscribeCustodyStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<{ room: string; storeId: number }> {
    const identity = this.identityOf(client);
    const storeId = this.requireStoreId(payload?.storeId);
    await this.commerceAccessService.ensureCanAccessStoreWithAnyPermission(
      this.toAuthenticatedUser(identity),
      storeId,
      ['custody:view', 'custody:pickup'],
      '无权订阅该门店客存',
    );
    const room = this.realtimeService.storeRoom(storeId);
    await client.join(room);
    this.logger.log(
      `subscribe.custody-store joined: socketId=${client.id}, userId=${identity.userId}, room=${room}`,
    );
    return { room, storeId };
  }

  /** C 端 H5 订阅本人会员房间：按 (门店 + 手机号) 解析，与 C 端接口同口径 */
  @SubscribeMessage('subscribe.custody-member')
  async subscribeCustodyMember(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<SubscribeMemberResult> {
    const identity = this.identityOf(client);
    const storeId = this.requireStoreId(payload?.storeId);
    const memberId = await resolveCustodyMemberId(
      this.prisma,
      storeId,
      identity.phone,
    );
    if (memberId === null) {
      throw new BadRequestException('该门店无会员档案，无法订阅客存通知');
    }
    const room = this.realtimeService.memberRoom(memberId);
    await client.join(room);
    this.logger.log(
      `subscribe.custody-member joined: socketId=${client.id}, room=${room}`,
    );
    return { room, storeId, memberId };
  }

  private requireStoreId(value: unknown): number {
    const storeId = Number(value);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new BadRequestException('门店编号无效');
    }
    return storeId;
  }

  private async authenticateBeforeConnection(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    try {
      client.data.identity = await this.authenticate(client);
      next();
    } catch (_error) {
      this.logger.warn(`拒绝未鉴权客存 Socket 连接: ${client.id}`);
      next(new Error('认证失败，请重新登录'));
    }
  }

  private async authenticate(client: Socket): Promise<SocketIdentity> {
    const rawToken =
      client.handshake.auth?.token ??
      client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof rawToken !== 'string' || !rawToken) {
      throw new UnauthorizedException('缺少访问令牌');
    }
    const payload = this.jwtService.verify<JwtPayload>(rawToken);
    if (!payload.sub) throw new UnauthorizedException('访问令牌无效');
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { email: true },
    });
    if (!account) throw new UnauthorizedException('用户不存在');
    return {
      userId: payload.sub,
      email: account.email,
      phone: payload.phone,
      currentMembership:
        await this.authMembershipResolverService.resolveAuthenticatedMembership(
          payload,
          account.email,
        ),
    };
  }

  private toAuthenticatedUser(identity: SocketIdentity): AuthenticatedUser {
    return {
      id: identity.userId,
      email: identity.email,
      phone: identity.phone,
      name: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastActiveAt: null,
      currentMembership: identity.currentMembership,
    };
  }

  private identityOf(client: Socket): SocketIdentity {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity) throw new UnauthorizedException('连接尚未认证');
    return identity;
  }
}
