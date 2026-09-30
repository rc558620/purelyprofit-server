import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { resolveCustodyMemberId } from '../shared/custody/custody-member.resolver';
import {
  CustodyRealtimeService,
  type CustodyRealtimeEvent,
  type CustodyRealtimePayload,
} from '../purely-club/custody/custody-realtime.service';
import type { JwtPayload } from '../purely-profit/auth/strategies/jwt.strategy';

type RawData = string | Buffer | ArrayBuffer | Buffer[];

interface WebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, data?: string): void;
  on(event: 'message', listener: (raw: RawData) => void): void;
  on(event: 'close' | 'error', listener: () => void): void;
}

interface SocketStream {
  socket?: WebSocket;
}

const resolveWebSocket = (connection: unknown): WebSocket => {
  const stream = connection as SocketStream;
  const socket = stream.socket ?? (connection as WebSocket);
  if (typeof socket.send !== 'function' || typeof socket.on !== 'function') {
    throw new Error('原生 WebSocket 连接无效');
  }
  return socket;
};

interface ClientMessage {
  type: 'subscribe.custody-member' | 'unsubscribe.custody-member' | 'ping';
  storeId?: number;
}

const send = (socket: WebSocket, message: unknown): void => {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
};

const parseMessage = (raw: RawData): ClientMessage | null => {
  try {
    const text =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : raw instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(raw)).toString('utf8')
            : raw.toString('utf8');
    const parsed = JSON.parse(text) as ClientMessage;
    return parsed && typeof parsed.type === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const requireStoreId = (value: unknown): number | null => {
  const storeId = Number(value);
  return Number.isInteger(storeId) && storeId > 0 ? storeId : null;
};

/**
 * 客存 C 端原生 WebSocket 路由（微信小程序专用）。
 *
 * - token 鉴权：JWT 校验后取出 userId 与 phone
 * - `subscribe.custody-member` 带 storeId，按「门店 + 手机号」解析 memberId 入房，
 *   与 C 端客存接口同一口径（见 custody-member.resolver.ts）
 * - 推送格式 `{ type: 事件名, payload }`，与扫码点餐原生通道一致
 * - 连接关闭时注销订阅，避免连接泄漏（S15）
 *
 * 注意：@fastify/websocket 插件已由 registerScanOrderingNativeWebsocket 注册，
 * 本函数只追加路由，重复 register 会抛插件已注册错误。
 */
export function registerCustodyNativeWebsocket(
  app: NestFastifyApplication,
): void {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  const logger = new Logger('CustodyNativeWebsocket');
  const jwtService = app.get(JwtService);
  const prisma = app.get(PrismaService);
  const realtime = app.get(CustodyRealtimeService);

  fastify.get('/api/ws/custody', { websocket: true }, (connection, request) => {
    const socket = resolveWebSocket(connection);
    const { token, storeId: storeIdQuery } = request.query as {
      token?: string;
      storeId?: string;
    };

    let userId: number;
    let phone: string;
    try {
      const payload = jwtService.verify<JwtPayload>(token ?? '');
      if (!payload.sub) throw new Error('invalid token');
      userId = payload.sub;
      phone = payload.phone;
    } catch {
      send(socket, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: '认证失败，请重新登录',
      });
      socket.close(4001, 'unauthorized');
      return;
    }

    let unsubscribeMember: (() => void) | null = null;
    let subscribedStoreId: number | null = null;

    const subscribeMember = async (storeId: number): Promise<void> => {
      if (subscribedStoreId === storeId && unsubscribeMember) return;
      const memberId = await resolveCustodyMemberId(prisma, storeId, phone);
      if (memberId === null) {
        // 诊断：这条分支原本只回 error 帧、不打日志，而客户端又会丢弃非业务帧，
        // 导致「订阅已发出却永远收不到推送」在全链路无痕，排查成本极高。
        // 手机号按脱敏口径打印（只留后四位），既能与店员输入的号码比对，也不落全号到日志。
        logger.warn(
          `客存订阅无会员档案: userId=${userId}, storeId=${storeId}, ` +
            `phoneIsPlaceholder=${String(phone).startsWith('club_wechat:')}, ` +
            `phoneTail=${String(phone).slice(-4)}`,
        );
        send(socket, {
          type: 'error',
          code: 'NO_MEMBER_PROFILE',
          message: '该门店未登记会员档案，无法接收客存通知',
        });
        return;
      }
      unsubscribeMember?.();
      subscribedStoreId = storeId;
      unsubscribeMember = realtime.subscribeMember(
        memberId,
        (event: CustodyRealtimeEvent, payload: CustodyRealtimePayload) => {
          send(socket, { type: event, payload });
        },
      );
      logger.log(
        `客存原生 WebSocket 已订阅: userId=${userId}, storeId=${storeId}, memberId=${memberId}`,
      );
      send(socket, { type: 'subscribed.custody-member', storeId, memberId });
    };

    const handleMessage = async (raw: RawData): Promise<void> => {
      const message = parseMessage(raw);
      if (!message) {
        send(socket, {
          type: 'error',
          code: 'BAD_MESSAGE',
          message: '消息格式错误',
        });
        return;
      }
      if (message.type === 'ping') {
        send(socket, { type: 'pong' });
        return;
      }
      if (message.type === 'unsubscribe.custody-member') {
        unsubscribeMember?.();
        unsubscribeMember = null;
        subscribedStoreId = null;
        return;
      }
      const storeId = requireStoreId(message.storeId);
      if (storeId === null) {
        send(socket, {
          type: 'error',
          code: 'BAD_STORE_ID',
          message: '门店编号无效',
        });
        return;
      }
      try {
        await subscribeMember(storeId);
      } catch (error: unknown) {
        logger.warn(
          `客存原生 WebSocket 订阅失败: userId=${userId}, storeId=${storeId}, error=${error instanceof Error ? error.message : String(error)}`,
        );
        send(socket, {
          type: 'error',
          code: 'SUBSCRIBE_FAILED',
          message: '订阅客存通知失败，请稍后重试',
        });
      }
    };

    send(socket, { type: 'authenticated' });

    const subscribeInitialStore = async (storeId: number): Promise<void> => {
      try {
        await subscribeMember(storeId);
      } catch (error: unknown) {
        logger.warn(
          `客存原生 WebSocket 初始订阅失败: userId=${userId}, storeId=${storeId}, error=${error instanceof Error ? error.message : String(error)}`,
        );
        send(socket, {
          type: 'error',
          code: 'SUBSCRIBE_FAILED',
          message: '订阅客存通知失败，请稍后重试',
        });
      }
    };

    // 页面带 storeId 打开时首帧即订阅，省掉一次往返
    const initialStoreId = requireStoreId(storeIdQuery);
    if (initialStoreId !== null) {
      void subscribeInitialStore(initialStoreId);
    }

    const cleanup = (): void => {
      unsubscribeMember?.();
      unsubscribeMember = null;
      subscribedStoreId = null;
    };
    socket.on('message', (raw: RawData) => {
      void handleMessage(raw);
    });
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
