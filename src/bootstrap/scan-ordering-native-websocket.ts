import websocket from '@fastify/websocket';
import { JwtService } from '@nestjs/jwt';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
type RawData = string | Buffer | ArrayBuffer | Buffer[];

interface WebSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, data?: string): void;
  on(event: 'message', listener: (raw: RawData) => void): void;
  on(event: 'close' | 'error', listener: () => void): void;
}
import { PrismaService } from '../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../purely-club/scan-ordering/scan-ordering-realtime.service';
import type { JwtPayload } from '../purely-profit/auth/strategies/jwt.strategy';

interface ClientMessage {
  type: 'subscribe.order' | 'unsubscribe.order' | 'ping';
  orderId?: number;
}

const send = (socket: WebSocket, message: unknown): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
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

  fastify.get(
    '/api/ws/scan-ordering',
    { websocket: true },
    (socket, request) => {
      const token = (request.query as { token?: string }).token;
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
      send(socket, { type: 'authenticated' });
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
          realtime.subscribeNativeOrder(orderId, (payload) =>
            send(socket, payload),
          ),
        );
        send(socket, { type: 'subscribed', orderId });
      };
      socket.on('close', () =>
        unsubscribers.forEach((unsubscribe) => unsubscribe()),
      );
      socket.on('error', () =>
        unsubscribers.forEach((unsubscribe) => unsubscribe()),
      );
    },
  );
}
