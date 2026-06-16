import * as childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compress from '@fastify/compress';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { recordHttpRequest } from './observability';
import { AppModule } from './app.module';

interface ListenAddressInUseError extends Error {
  code?: string;
}

interface SwaggerOperationLike {
  tags?: string[];
}

interface SwaggerTagLike {
  name: string;
  description?: string;
}

interface SwaggerPathItemLike {
  post?: SwaggerOperationLike;
}

interface SwaggerDocumentLike {
  paths?: Record<string, SwaggerPathItemLike>;
  tags?: SwaggerTagLike[];
}

interface ListeningProcessInfo {
  command: string;
  pid: number;
  port: number;
}

const CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG = 'Dev Only / Fallback';
const CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS = [
  '/club/orders/{id}/confirm-paid',
  '/club/recharge/orders/{id}/confirm-paid',
] as const;

function resolveCorsOrigin(corsOrigin: string): true | string[] {
  if (corsOrigin === '*') {
    return true;
  }

  return corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeObservedRoute(url: string): string {
  const [path = '/'] = url.split('?');
  return path || '/';
}

function setupHttpObservability(
  app: NestFastifyApplication,
  slowLogEnabled: boolean,
  thresholdMs: number,
): void {
  const requestStartTimeMap = new Map<string, number>();
  const httpAdapter = app.getHttpAdapter().getInstance();
  const STALE_ENTRY_MAX_AGE_MS = 5 * 60_000;
  const CLEANUP_INTERVAL_MS = 60_000;

  const cleanupStaleEntries = () => {
    const now = Date.now();
    for (const [requestId, startedAt] of requestStartTimeMap) {
      if (now - startedAt > STALE_ENTRY_MAX_AGE_MS) {
        requestStartTimeMap.delete(requestId);
      }
    }
  };

  const cleanupTimer = setInterval(cleanupStaleEntries, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();

  httpAdapter.addHook('onRequest', (request, _reply, done) => {
    requestStartTimeMap.set(String(request.id), Date.now());
    done();
  });

  httpAdapter.addHook('onError', (request, _reply, _error, done) => {
    requestStartTimeMap.delete(String(request.id));
    done();
  });

  httpAdapter.addHook('onTimeout', (request, _reply, done) => {
    requestStartTimeMap.delete(String(request.id));
    done();
  });

  httpAdapter.addHook('onResponse', (request, reply, done) => {
    const requestId = String(request.id);
    const requestStartedAt = requestStartTimeMap.get(requestId);
    requestStartTimeMap.delete(requestId);

    if (requestStartedAt === undefined) {
      done();
      return;
    }

    const durationMs = Date.now() - requestStartedAt;
    const route = normalizeObservedRoute(request.url);

    recordHttpRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
      requestId,
      slowThresholdMs: thresholdMs,
    });

    if (slowLogEnabled && durationMs >= thresholdMs) {
      console.warn(
        `[slow-request] ${request.method} ${route} ${reply.statusCode} ${durationMs}ms requestId=${requestId}`,
      );
    }

    done();
  });

  process.on('SIGTERM', () => clearInterval(cleanupTimer));
  process.on('SIGINT', () => clearInterval(cleanupTimer));
}

function isListenAddressInUseError(
  error: unknown,
): error is ListenAddressInUseError {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as ListenAddressInUseError).code === 'EADDRINUSE'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseListeningProcesses(rawOutput: string): ListeningProcessInfo[] {
  return rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(\d+)\s+.*TCP .*:(\d+) \(LISTEN\)$/);

      if (!match) {
        return null;
      }

      const [, command, processIdRaw, portRaw] = match;
      const processId = Number.parseInt(processIdRaw, 10);
      const port = Number.parseInt(portRaw, 10);

      if (!Number.isInteger(processId) || processId <= 0) {
        return null;
      }

      if (!Number.isInteger(port) || port <= 0) {
        return null;
      }

      return {
        command,
        pid: processId,
        port,
      } satisfies ListeningProcessInfo;
    })
    .filter((item): item is ListeningProcessInfo => item !== null)
    .filter((item) => item.pid !== process.pid);
}

function findListeningProcesses(): ListeningProcessInfo[] {
  if (process.platform === 'win32') {
    return [];
  }

  const result = childProcess.spawnSync(
    'lsof',
    ['-nP', '-iTCP', '-sTCP:LISTEN'],
    {
      encoding: 'utf8',
    },
  );

  if (result.error) {
    return [];
  }

  return parseListeningProcesses(String(result.stdout ?? ''));
}

function findNodeProcessIdsListeningOnPort(port: number): number[] {
  return findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port === port)
    .map((processInfo) => processInfo.pid);
}

async function waitForPortToBeReleased(
  port: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (findNodeProcessIdsListeningOnPort(port).length === 0) {
      return true;
    }

    await delay(pollIntervalMs);
  }

  return findNodeProcessIdsListeningOnPort(port).length === 0;
}

async function forceStopProcessIds(
  processIds: number[],
  signal: NodeJS.Signals,
): Promise<void> {
  for (const processId of processIds) {
    try {
      process.kill(processId, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn(
        `[bootstrap] 发送 ${signal} 给进程 ${processId} 失败: ${message}`,
      );
    }
  }
}

async function terminateProcessesListeningOnPort(
  port: number,
): Promise<boolean> {
  const processIds = findNodeProcessIdsListeningOnPort(port);

  if (processIds.length === 0) {
    return false;
  }

  console.warn(
    `[bootstrap] 端口 ${port} 已被占用，尝试停止旧进程: ${processIds.join(', ')}`,
  );

  await forceStopProcessIds(processIds, 'SIGTERM');

  if (await waitForPortToBeReleased(port, 1500, 150)) {
    console.warn(`[bootstrap] 端口 ${port} 的旧进程已停止，重新尝试监听`);
    return true;
  }

  console.warn(
    `[bootstrap] 端口 ${port} 的旧进程未及时退出，升级为 SIGKILL 强制停止`,
  );
  await forceStopProcessIds(processIds, 'SIGKILL');

  if (await waitForPortToBeReleased(port, 1500, 150)) {
    console.warn(`[bootstrap] 端口 ${port} 的旧进程已强制停止，重新尝试监听`);
    return true;
  }

  console.warn(
    `[bootstrap] 端口 ${port} 的旧进程未在超时内退出，继续尝试其他端口策略`,
  );
  return false;
}

async function terminateNodeProcessesInPortRange(
  startPort: number,
  endPort: number,
): Promise<number[]> {
  const targetProcesses = findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port >= startPort)
    .filter((processInfo) => processInfo.port <= endPort);

  if (targetProcesses.length === 0) {
    return [];
  }

  const processIds = Array.from(
    new Set(targetProcesses.map((item) => item.pid)),
  );
  const descriptors = targetProcesses.map((item) => `${item.pid}@${item.port}`);

  console.warn(
    `[bootstrap] 启动前清理 ${startPort}-${endPort} 端口残留进程: ${descriptors.join(', ')}`,
  );

  await forceStopProcessIds(processIds, 'SIGTERM');
  await delay(1200);

  const remainingProcesses = findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port >= startPort)
    .filter((processInfo) => processInfo.port <= endPort);

  if (remainingProcesses.length > 0) {
    const remainingIds = Array.from(
      new Set(remainingProcesses.map((processInfo) => processInfo.pid)),
    );
    console.warn(
      `[bootstrap] ${startPort}-${endPort} 仍有残留端口，占用进程升级为 SIGKILL: ${remainingIds.join(', ')}`,
    );
    await forceStopProcessIds(remainingIds, 'SIGKILL');
    await delay(1200);
  }

  const finalRemainingProcesses = findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port >= startPort)
    .filter((processInfo) => processInfo.port <= endPort);

  if (finalRemainingProcesses.length > 0) {
    console.warn(
      `[bootstrap] 启动前仍有端口残留: ${finalRemainingProcesses
        .map((item) => `${item.pid}@${item.port}`)
        .join(', ')}`,
    );
  }

  return processIds;
}

export function filterSwaggerDocumentForEnvironment(
  document: SwaggerDocumentLike,
  options: {
    manualConfirmPaidEnabled: boolean;
  },
): SwaggerDocumentLike {
  if (!document.paths) {
    return document;
  }

  if (!options.manualConfirmPaidEnabled) {
    for (const path of CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS) {
      delete document.paths[path];
    }
    return document;
  }

  document.tags = ensureSwaggerTag(document.tags, {
    name: CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG,
    description: '仅开发联调使用的支付兜底接口，生产链路请改用支付回调驱动。',
  });

  for (const path of CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS) {
    const operation = document.paths[path]?.post;
    if (!operation) {
      continue;
    }

    operation.tags = Array.from(
      new Set([
        ...(operation.tags ?? []),
        CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG,
      ]),
    );
  }

  return document;
}

function ensureSwaggerTag(
  tags: SwaggerTagLike[] | undefined,
  targetTag: SwaggerTagLike,
): SwaggerTagLike[] {
  const normalizedTags = tags ? [...tags] : [];
  const exists = normalizedTags.some((tag) => tag.name === targetTag.name);
  if (!exists) {
    normalizedTags.push(targetTag);
  }
  return normalizedTags;
}

function getTrimmedConfigValue(
  configService: ConfigService,
  key: string,
): string {
  return configService.get<string>(key)?.trim() ?? '';
}

function validateProductionConfiguration(configService: ConfigService): void {
  const errors: string[] = [];
  const corsOrigin = getTrimmedConfigValue(configService, 'app.corsOrigin');
  const databaseUrl = getTrimmedConfigValue(configService, 'database.url');
  const jwtSecret = getTrimmedConfigValue(configService, 'jwt.secret');
  const redisHost = getTrimmedConfigValue(configService, 'redis.host');
  const wechatAppId = getTrimmedConfigValue(configService, 'wechat.appId');
  const wechatAppSecret = getTrimmedConfigValue(
    configService,
    'wechat.appSecret',
  );
  const wechatNotifyUrl = getTrimmedConfigValue(
    configService,
    'wechat.payNotifyUrl',
  );
  const wechatMchSerialNo = getTrimmedConfigValue(
    configService,
    'wechat.mchSerialNo',
  );
  const wechatPrivateKeyPath = getTrimmedConfigValue(
    configService,
    'wechat.privateKeyPath',
  );
  const wechatPrivateKeyContent = getTrimmedConfigValue(
    configService,
    'wechat.privateKeyContent',
  );
  const wechatPlatformPublicKey = getTrimmedConfigValue(
    configService,
    'wechat.platformPublicKeyContent',
  );
  const manualConfirmPaidEnabled =
    configService.get<boolean>('club.manualConfirmPaidEnabled') ?? false;
  const portAutoTerminateEnabled =
    configService.get<boolean>('app.portAutoTerminateEnabled') ?? false;
  const portAutoShiftEnabled =
    configService.get<boolean>('app.portAutoShiftEnabled') ?? false;
  const swaggerEnabled =
    configService.get<boolean>('app.swaggerEnabled') ?? false;

  if (!databaseUrl) {
    errors.push('database.url 未配置');
  }

  if (!redisHost) {
    errors.push('redis.host 未配置');
  }

  if (!jwtSecret || jwtSecret === 'secret') {
    errors.push('jwt.secret 未配置或仍在使用默认值');
  }

  if (!corsOrigin || corsOrigin === '*' || corsOrigin.includes('yourdomain.com')) {
    errors.push('app.corsOrigin 生产环境必须配置为正式域名白名单');
  }

  if (!wechatAppId || wechatAppId.startsWith('wx_your_')) {
    errors.push('wechat.appId 未配置或仍在使用示例值');
  }

  if (!wechatAppSecret || wechatAppSecret.includes('your_miniprogram_appsecret')) {
    errors.push('wechat.appSecret 未配置或仍在使用示例值');
  }

  if (!wechatMchSerialNo || wechatMchSerialNo.includes('your_mch_api_certificate_serial_no')) {
    errors.push('wechat.mchSerialNo 未配置或仍在使用示例值');
  }

  if (!wechatPrivateKeyPath && !wechatPrivateKeyContent) {
    errors.push('wechat.privateKeyPath / wechat.privateKeyContent 至少要配置一个');
  }

  if (wechatPrivateKeyPath && !existsSync(wechatPrivateKeyPath)) {
    errors.push('wechat.privateKeyPath 指向的文件不存在');
  }

  if (!wechatPlatformPublicKey) {
    errors.push(
      'wechat.platformPublicKeyContent 未配置，生产环境必须启用微信支付回调 RSA 验签',
    );
  }

  if (
    !wechatNotifyUrl ||
    !wechatNotifyUrl.startsWith('https://') ||
    wechatNotifyUrl.includes('yourdomain.com')
  ) {
    errors.push('wechat.payNotifyUrl 生产环境必须是可访问的 HTTPS 正式地址');
  }

  if (manualConfirmPaidEnabled) {
    errors.push('club.manualConfirmPaidEnabled 生产环境必须为 false');
  }

  if (portAutoTerminateEnabled) {
    errors.push('app.portAutoTerminateEnabled 生产环境必须关闭');
  }

  if (portAutoShiftEnabled) {
    errors.push('app.portAutoShiftEnabled 生产环境必须关闭');
  }

  if (swaggerEnabled) {
    errors.push('app.swaggerEnabled 生产环境必须关闭');
  }

  if (errors.length > 0) {
    throw new Error(
      `[bootstrap] 生产配置校验失败:\n- ${errors.join('\n- ')}`,
    );
  }
}

async function listenWithPortFallback(
  app: NestFastifyApplication,
  preferredPort: number,
  host: string,
  autoTerminateEnabled: boolean,
  autoShiftEnabled: boolean,
  maxOffset: number,
): Promise<number> {
  const safeMaxOffset = Math.max(0, maxOffset);
  let offset = 0;

  while (offset <= safeMaxOffset) {
    const currentPort = preferredPort + offset;

    try {
      await app.listen(currentPort, host);
      return currentPort;
    } catch (error) {
      const isAddressInUse = isListenAddressInUseError(error);
      const terminatedExistingProcess =
        autoTerminateEnabled &&
        isAddressInUse &&
        (await terminateProcessesListeningOnPort(currentPort));

      if (terminatedExistingProcess) {
        continue;
      }

      const canRetry =
        autoShiftEnabled && isAddressInUse && offset < safeMaxOffset;

      if (!canRetry) {
        throw error;
      }

      console.warn(
        `[bootstrap] 端口 ${currentPort} 已被占用，自动尝试 ${currentPort + 1}`,
      );
      offset += 1;
    }
  }

  throw new Error('服务启动失败：未找到可用监听端口');
}

export async function bootstrap(): Promise<void> {
  const bootstrapConfigService = new ConfigService();
  const isProduction =
    (bootstrapConfigService.get<string>('nodeEnv') ?? 'development') ===
    'production';
  const loggerEnabled =
    bootstrapConfigService.get<boolean>('app.logEnabled') ?? !isProduction;
  const bodyLimit =
    bootstrapConfigService.get<number>('app.httpBodyLimitBytes') ??
    5 * 1024 * 1024;
  const keepAliveTimeout =
    bootstrapConfigService.get<number>('app.httpKeepAliveTimeoutMs') ?? 65_000;
  const requestTimeout =
    bootstrapConfigService.get<number>('app.httpRequestTimeoutMs') ?? 15_000;

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: loggerEnabled,
      bodyLimit,
      keepAliveTimeout,
      requestTimeout,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.register(compress, {
    encodings: ['gzip', 'deflate'],
    threshold: 1024,
  });

  const configService = app.get(ConfigService);
  if (isProduction) {
    validateProductionConfiguration(configService);
  }
  app.setGlobalPrefix('api');

  const corsOrigin = configService.get<string>('app.corsOrigin') ?? '*';
  app.enableCors({
    origin: resolveCorsOrigin(corsOrigin),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Requested-With'],
    credentials: true,
  });

  const slowRequestLogEnabled =
    configService.get<boolean>('app.slowRequestLogEnabled') ?? true;
  const slowRequestThresholdMs =
    configService.get<number>('app.slowRequestThresholdMs') ?? 800;
  setupHttpObservability(app, slowRequestLogEnabled, slowRequestThresholdMs);

  const swaggerEnabled =
    configService.get<boolean>('app.swaggerEnabled') ?? !isProduction;

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('PurelyProfit API')
      .setDescription('PurelyProfit 后端接口文档')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    const manualConfirmPaidEnabled =
      configService.get<boolean>('club.manualConfirmPaidEnabled') ??
      !isProduction;
    filterSwaggerDocumentForEnvironment(document, {
      manualConfirmPaidEnabled,
    });
    SwaggerModule.setup('api-docs', app, document);
  }

  const preferredPort = configService.get<number>('port') ?? 3000;
  const portAutoTerminateEnabled =
    configService.get<boolean>('app.portAutoTerminateEnabled') ?? !isProduction;
  const portAutoShiftEnabled =
    configService.get<boolean>('app.portAutoShiftEnabled') ?? !isProduction;
  const portAutoShiftMaxOffset =
    configService.get<number>('app.portAutoShiftMaxOffset') ?? 20;

  if (portAutoTerminateEnabled) {
    await terminateNodeProcessesInPortRange(
      preferredPort,
      preferredPort + Math.max(0, portAutoShiftMaxOffset),
    );
  }

  const listeningPort = await listenWithPortFallback(
    app,
    preferredPort,
    '0.0.0.0',
    portAutoTerminateEnabled,
    portAutoShiftEnabled,
    portAutoShiftMaxOffset,
  );

  if (listeningPort !== preferredPort) {
    console.warn(
      `[bootstrap] 默认端口 ${preferredPort} 已被占用，服务改为监听 ${listeningPort}`,
    );
  }

  console.log(`Server running on http://localhost:${listeningPort}`);
  if (swaggerEnabled) {
    console.log(`Swagger docs at http://localhost:${listeningPort}/api-docs`);
  }
}

if (require.main === module) {
  void bootstrap();
}
