import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PrintAgentService } from '../purely-profit/operations/scan-ordering/print-agent.service';
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

/** 代理 → 服务端消息。 */
interface AgentMessage {
  type: 'pong' | 'print.done' | 'printers';
  taskId?: string;
  ok?: boolean;
  error?: string | null;
  printers?: Array<{ id: string; name: string; type: string }>;
}

const send = (socket: WebSocket, message: unknown): void => {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
};

const parseMessage = (raw: RawData): AgentMessage | null => {
  try {
    const text =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : raw instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(raw)).toString('utf8')
            : raw.toString('utf8');
    const parsed = JSON.parse(text) as AgentMessage;
    return parsed && typeof parsed.type === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

/** 心跳间隔：保持连接活跃并同步"最后在线时间"。 */
const PING_INTERVAL_MS = 30_000;

/**
 * 扫码点餐打印代理 WebSocket 路由（原生 WS，供 Go 打印代理连接）。
 * - token 鉴权：校验 stores.print_agent_token
 * - 服务端下发打印任务 { type:'print', taskId, target, dataBase64 }
 * - 代理上报回执 { type:'print.done', taskId, ok, error } 与打印机列表 { type:'printers' }
 * - 周期 ping 保活 + 更新最后在线时间
 */
/** 代理注册请求体。 */
interface RegisterBody {
  bindCode?: string;
  deviceId?: string;
  platform?: string;
  version?: string;
}

export function registerPrintAgentNativeWebsocket(
  app: NestFastifyApplication,
): void {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  const logger = new Logger('PrintAgentWebsocket');
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const agentService = app.get(PrintAgentService);

  // 代理注册接口（公开）：客户在门店电脑代理中输入绑定码换取代理令牌。
  // 走 fastify 直连注册，绕过商家端 JWT 守卫（Go 代理无浏览器会话）。
  // 限流：按来源 IP 每分钟最多 10 次，防绑定码暴力枚举。
  fastify.post('/api/print-agent/register', async (request, reply) => {
    const ip = request.ip ?? 'unknown';
    const attempts = await redis.incr(`print-agent:register:${ip}`, 60);
    if (attempts > 10) {
      return reply
        .code(429)
        .send({ message: '注册尝试过于频繁，请 1 分钟后再试' });
    }
    const body = (request.body ?? {}) as RegisterBody;
    const bindCode = String(body.bindCode ?? '').trim();
    if (bindCode.length < 6 || bindCode.length > 16) {
      return reply.code(400).send({ message: '绑定码无效' });
    }
    try {
      const result = await agentService.register(
        bindCode,
        String(body.deviceId ?? '').trim() || undefined,
        body.platform,
        body.version,
      );
      return reply.code(200).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '注册失败';
      const code = message.includes('绑定码无效') ? 400 : 500;
      return reply.code(code).send({ message });
    }
  });

  fastify.get(
    '/api/ws/print-agent',
    { websocket: true },
    (connection, request) => {
      const socket = resolveWebSocket(connection);
      const { token } = request.query as { token?: string };

      void (async () => {
        const found = await prisma.printAgent.findFirst({
          where: { token: token ?? '' },
          select: { storeId: true },
        });
        // 旧代理兼容：新表未命中时回退门店单 token 校验
        const legacyStore = found
          ? null
          : await prisma.store.findFirst({
              where: { printAgentToken: token ?? '' },
              select: { id: true },
            });
        const storeId = found?.storeId ?? legacyStore?.id ?? null;
        if (storeId == null) {
          send(socket, {
            type: 'error',
            code: 'UNAUTHORIZED',
            message: '代理令牌无效，请重新绑定',
          });
          socket.close(4001, 'unauthorized');
          return;
        }
        void agentService.attach(storeId, socket).catch((error) => {
          logger.warn(
            `打印代理挂载异常: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        send(socket, { type: 'welcome', storeId });
        logger.log(`打印代理已连接: storeId=${storeId}`);

        // 心跳兜底：service 已内部容错（Redis 不可用降级），此处仅防未知异常成为 unhandled rejection
        const safeTouch = (): void => {
          void agentService.touch(storeId).catch((error) => {
            logger.warn(
              `打印代理心跳异常: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        };

        const pingTimer = setInterval(() => {
          safeTouch();
          send(socket, { type: 'ping' });
        }, PING_INTERVAL_MS);

        const cleanup = (): void => {
          clearInterval(pingTimer);
          void agentService.detach(storeId, socket).catch((error) => {
            logger.warn(
              `打印代理卸载异常: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        };

        socket.on('message', (raw) => {
          const message = parseMessage(raw);
          if (!message) {
            send(socket, {
              type: 'error',
              code: 'BAD_MESSAGE',
              message: '消息格式错误',
            });
            return;
          }
          if (message.type === 'pong') return;
          if (message.type === 'print.done') {
            safeTouch();
            logger.log(
              `打印回执: storeId=${storeId} taskId=${message.taskId ?? '-'} ok=${String(message.ok)}`,
            );
            return;
          }
          if (message.type === 'printers') {
            safeTouch();
            agentService.setPrinters(
              storeId,
              (message.printers ?? []).map((printer) => ({
                id: printer.id,
                name: printer.name,
                type: printer.type as 'device' | 'cups' | 'windows',
              })),
            );
            return;
          }
        });

        socket.on('close', cleanup);
        socket.on('error', cleanup);
      })();
    },
  );
}
