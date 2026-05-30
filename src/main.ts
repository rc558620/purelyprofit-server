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

async function bootstrap() {
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

  const port = configService.get<number>('port') ?? 3000;

  await app.listen(port, '0.0.0.0');
  console.log(`Server running on http://localhost:${port}`);
  if (swaggerEnabled) {
    console.log(`Swagger docs at http://localhost:${port}/api-docs`);
  }
}
void bootstrap();
