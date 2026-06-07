import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { recordHttpRequest } from './observability';
import { AppModule } from './app.module';

interface ListenAddressInUseError extends Error {
  code?: string;
}

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

  httpAdapter.addHook('onRequest', (request, _reply, done) => {
    requestStartTimeMap.set(String(request.id), Date.now());
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

async function listenWithPortFallback(
  app: NestFastifyApplication,
  preferredPort: number,
  host: string,
  autoShiftEnabled: boolean,
  maxOffset: number,
): Promise<number> {
  const safeMaxOffset = Math.max(0, maxOffset);

  for (let offset = 0; offset <= safeMaxOffset; offset += 1) {
    const currentPort = preferredPort + offset;

    try {
      await app.listen(currentPort, host);
      return currentPort;
    } catch (error) {
      const canRetry =
        autoShiftEnabled &&
        isListenAddressInUseError(error) &&
        offset < safeMaxOffset;

      if (!canRetry) {
        throw error;
      }

      console.warn(
        `[bootstrap] 端口 ${currentPort} 已被占用，自动尝试 ${currentPort + 1}`,
      );
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

  const configService = app.get(ConfigService);
  app.setGlobalPrefix('api');

  const corsOrigin = configService.get<string>('app.corsOrigin') ?? '*';
  app.enableCors({ origin: resolveCorsOrigin(corsOrigin) });

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
    SwaggerModule.setup('api-docs', app, document);
  }

  const preferredPort = configService.get<number>('port') ?? 3000;
  const portAutoShiftEnabled =
    configService.get<boolean>('app.portAutoShiftEnabled') ?? !isProduction;
  const portAutoShiftMaxOffset =
    configService.get<number>('app.portAutoShiftMaxOffset') ?? 20;
  const listeningPort = await listenWithPortFallback(
    app,
    preferredPort,
    '0.0.0.0',
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
