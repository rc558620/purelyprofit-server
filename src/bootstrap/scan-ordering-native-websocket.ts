import websocket from '@fastify/websocket';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
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

import { PrismaService } from '../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ServiceCallRealtimeService } from '../purely-club/service-call/service-call-realtime.service';
import type { JwtPayload } from '../purely-profit/auth/strategies/jwt.strategy';

interface ClientMessage {
  type:
    | 'subscribe.order'
    | 'unsubscribe.order'
    | 'subscribe.voucher-order'
    | 'unsubscribe.voucher-order'
    | 'subscribe.service-call'
    | 'ping';
  orderId?: number;
  orderNo?: string;
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

export async function registerScanOrderingNativeWebsocket(
  app: NestFastifyApplication,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  const logger = new Logger('ScanOrderingNativeWebsocket');
  await fastify.register(websocket, {
    options: {
      server: {
        on(event: string, listener: (...args: unknown[]) => void) {
          if (event !== 'upgrade') return fastify.server.on(event, listener);
          return fastify.server.prependListener(
            event,
            (request, socket, head) => {
              if (request.url?.startsWith('/socket.io/')) return;
              listener(request, socket, head);
            },
          );
        },
      } as unknown as typeof fastify.server,
    },
  });
  const jwtService = app.get(JwtService);
  const prisma = app.get(PrismaService);
  const realtime = app.get(ScanOrderingRealtimeService);
  const serviceCallRealtime = app.get(ServiceCallRealtimeService);

  // purelyClub 只能走原生 WebSocket，不能改成 Socket.IO 协议；
  // Cluster 下本地订阅由 Redis Pub/Sub 将状态事件送到持有该连接的 Worker。
  fastify.get(
    '/api/ws/scan-ordering',
    { websocket: true },
    (connection, request) => {
      const socket = resolveWebSocket(connection);
      const { token, orderId: orderIdQuery } = request.query as {
        token?: string;
        orderId?: string;
      };
      logger.log('扫码点餐原生 WebSocket 已建立，等待订单订阅');
      let userId: number;
      try {
        const payload = jwtService.verify<JwtPayload>(token ?? '');
        if (!payload.sub) throw new Error('invalid token');
        userId = payload.sub;
      } catch {
        send(socket, {
          type: 'error',
          code: 'UNAUTHORIZED',
          message: '认证失败，请重新登录',
        });
        socket.close(4001, 'unauthorized');
        return;
      }

      const unsubscribers = new Map<number, () => void>();
      const voucherUnsubscribers = new Map<string, () => void>();
      let unsubscribeServiceCall: (() => void) | null = null;
      const subscribeOrder = async (orderId: number): Promise<void> => {
        const order = await prisma.scanOrders.findFirst({
          where: { id: orderId, clubUserId: userId, deletedAt: null },
          select: { id: true },
        });
        if (!order)
          return send(socket, {
            type: 'error',
            code: 'FORBIDDEN',
            message: '无权订阅该订单',
          });
        if (unsubscribers.has(orderId)) return;
        unsubscribers.set(
          orderId,
          realtime.subscribeNativeOrder(orderId, (payload) => {
            logger.warn(
              `准备发送原生订单 WebSocket 状态: orderId=${orderId}, readyState=${socket.readyState}`,
            );
            try {
              socket.send(JSON.stringify(payload));
              logger.warn(
                `原生订单 WebSocket 状态已发送: orderId=${orderId}, readyState=${socket.readyState}`,
              );
            } catch (error) {
              logger.error(
                `扫码点餐原生 WebSocket 状态发送失败: orderId=${orderId}, error=${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }),
        );
        logger.log(`扫码点餐原生 WebSocket 已订阅订单: orderId=${orderId}`);
        send(socket, { type: 'subscribed', orderId });
      };
      const subscribeServiceCall = (): void => {
        if (unsubscribeServiceCall) return;
        unsubscribeServiceCall = serviceCallRealtime.subscribeClubUser(
          userId,
          (payload) => {
            logger.log(
              `向 Club 原生 WebSocket 发送 service_call.updated: serviceCallId=${payload.id}, status=${payload.status}, clubUserId=${userId}`,
            );
            send(socket, { type: 'service_call.updated', payload });
          },
        );
        logger.log(
          `扫码点餐原生 WebSocket 已订阅服务呼叫: clubUserId=${userId}`,
        );
        send(socket, { type: 'subscribed.service-call' });
      };
      send(socket, { type: 'authenticated' });
      const initialOrderId = Number(orderIdQuery);
      if (Number.isInteger(initialOrderId) && initialOrderId > 0) {
        void subscribeOrder(initialOrderId);
      }

      const subscribeVoucherOrder = async (orderNo: string): Promise<void> => {
        const order = await prisma.clubVoucherOrder.findFirst({
          where: { orderNo, userId },
          select: { orderNo: true },
        });
        if (!order)
          return send(socket, {
            type: 'error',
            code: 'FORBIDDEN',
            message: '无权订阅该团购券订单',
          });
        if (voucherUnsubscribers.has(orderNo)) return;
        voucherUnsubscribers.set(
          orderNo,
          realtime.subscribeNativeVoucherOrder(orderNo, (payload) => {
            try {
              socket.send(JSON.stringify(payload));
              logger.log(
                `原生团购券订单 WebSocket 状态已发送: orderNo=${orderNo}, readyState=${socket.readyState}`,
              );
            } catch (error) {
              logger.error(
                `原生团购券订单 WebSocket 发送失败: orderNo=${orderNo}, error=${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }),
        );
        logger.log(
          `扫码点餐原生 WebSocket 已订阅团购券订单: orderNo=${orderNo}`,
        );
        send(socket, { type: 'subscribed.voucher-order', orderNo });
      };
      socket.on('message', (raw: RawData) => {
        void handleMessage(raw);
      });

      const handleMessage = async (raw: RawData): Promise<void> => {
        const message = parseMessage(raw);
        if (!message)
          return send(socket, {
            type: 'error',
            code: 'BAD_MESSAGE',
            message: '消息格式错误',
          });
        if (message.type === 'ping') return send(socket, { type: 'pong' });
        if (message.type === 'subscribe.service-call') {
          subscribeServiceCall();
          return;
        }
        if (message.type === 'subscribe.voucher-order') {
          if (typeof message.orderNo !== 'string' || !message.orderNo.trim()) {
            return send(socket, {
              type: 'error',
              code: 'BAD_ORDER_NO',
              message: '团购券订单号无效',
            });
          }
          await subscribeVoucherOrder(message.orderNo.trim());
          return;
        }
        if (message.type === 'unsubscribe.voucher-order') {
          if (message.orderNo) {
            voucherUnsubscribers.get(message.orderNo)?.();
            voucherUnsubscribers.delete(message.orderNo);
          }
          return;
        }
        if (!Number.isInteger(message.orderId) || (message.orderId ?? 0) <= 0) {
          return send(socket, {
            type: 'error',
            code: 'BAD_ORDER_ID',
            message: '订单编号无效',
          });
        }
        const orderId = message.orderId!;
        if (message.type === 'unsubscribe.order') {
          unsubscribers.get(orderId)?.();
          unsubscribers.delete(orderId);
          return;
        }
        await subscribeOrder(orderId);
      };
      const cleanup = (): void => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
        unsubscribers.clear();
        voucherUnsubscribers.forEach((unsubscribe) => unsubscribe());
        voucherUnsubscribers.clear();
        unsubscribeServiceCall?.();
        unsubscribeServiceCall = null;
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}
