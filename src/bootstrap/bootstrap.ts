import cluster from 'node:cluster';
import { PassThrough } from 'node:stream';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import etag from '@fastify/etag';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { setupHttpObservability } from './http-observability';
import {
  listenWithPortFallback,
  terminateNodeProcessesInPortRange,
} from './port.utils';
import { validateProductionConfiguration } from './production-config.utils';
import { createRequestIdGenerator } from './request-id.utils';
import { filterSwaggerDocumentForEnvironment } from './swagger.utils';

function resolveCorsOrigin(corsOrigin: string): true | string[] {
  if (corsOrigin === '*') {
    return true;
  }

  return corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * 为微信支付回调路由按需注入 rawBody。
 *
 * Fastify 的 content type parser 是全局注册的，无法 per-route。
 * 本函数通过 onRoute hook 拦截路由注册，在微信回调路由上添加 preParsing hook，
 * 在 body 被 content type parser 解析之前，拦截原始数据流并缓存到 request.rawBody，
 * 同时将数据透传给后续的 parser，确保微信签名校验使用的 rawBody 与 HTTP 原始请求体完全一致。
 *
 * 仅当路由 path 以 /club/payments/wechat/callback 结尾时注入。
 */
function setupRawBodyForWechatCallback(app: NestFastifyApplication): void {
  const WECHAT_CALLBACK_PATH = '/club/payments/wechat/callback';

  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onRoute', (routeOptions) => {
    const routePath = routeOptions.path ?? '';
    if (
      routePath.endsWith(WECHAT_CALLBACK_PATH) &&
      (routeOptions.method === 'POST' ||
        (Array.isArray(routeOptions.method) &&
          routeOptions.method.includes('POST')))
    ) {
      const existingPreParsing = routeOptions.preParsing ?? [];
      const preParsingHooks = Array.isArray(existingPreParsing)
        ? existingPreParsing
        : [existingPreParsing];

      // preParsing 在 content type parser 之前执行，此时数据尚未被解析。
      // 通过 PassThrough 流拦截原始数据，同时保存到 request.rawBody。

      const rawBodyPreParsing = ((
        request: any,
        _reply: any,
        payload: NodeJS.ReadableStream,
        done: (err?: Error | null, stream?: NodeJS.ReadableStream) => void,
      ) => {
        const chunks: Buffer[] = [];
        const passThrough = new PassThrough();

        payload.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        payload.on('end', () => {
          request.rawBody = Buffer.concat(chunks).toString('utf-8');
        });
        payload.on('error', (err: Error) => {
          done(err);
        });

        // 将原始数据透传给后续的 content type parser
        payload.pipe(passThrough);
        done(null, passThrough);
      }) as never;

      routeOptions.preParsing = [...preParsingHooks, rawBodyPreParsing];
    }
  });
}

async function registerGlobalPlugins(
  app: NestFastifyApplication,
): Promise<void> {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // HTTP 安全头：X-Content-Type-Options、X-Frame-Options、Strict-Transport-Security 等
  // 必须在 CORS 和 compress 之前注册，确保所有响应都携带安全头
  // contentSecurityPolicy 关闭：当前 API 服务不提供 HTML 页面，CSP 无实际收益且易误配
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // ETag 必须在 compress 之前注册，以便在压缩前生成内容哈希
  await app.register(etag, { weak: true });
  await app.register(compress, {
    encodings: ['gzip', 'deflate'],
    threshold: 1024,
  });
}

function logBootstrapResult(options: {
  listeningPort: number;
  preferredPort: number;
  isProduction: boolean;
  swaggerEnabled: boolean;
}): void {
  const { listeningPort, preferredPort, isProduction, swaggerEnabled } =
    options;
  const isWorker = !cluster.isPrimary;

  if (listeningPort !== preferredPort) {
    console.warn(
      `[bootstrap] 默认端口 ${preferredPort} 已被占用，服务改为监听 ${listeningPort}`,
    );
  }

  console.log(`Server running on http://localhost:${listeningPort}`);
  if (isWorker) {
    console.log(`[cluster] worker pid=${process.pid} ready`);
  } else if (isProduction) {
    console.warn(
      '[bootstrap] ⚠️ 生产环境建议使用 start:cluster 启动（当前为单进程模式），以充分利用多核 CPU。',
    );
  }
  if (swaggerEnabled) {
    console.log(`Swagger docs at http://localhost:${listeningPort}/api-docs`);
  }
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
      // 如果在 nginx/ALB 后面，获取真实 IP 和 HTTPS 标记
      trustProxy: true,
      // Fastify v5: ignoreTrailingSlash 移至 routerOptions
      routerOptions: {
        // 避免 /api/users/ → /api/users 的 302 重定向
        ignoreTrailingSlash: true,
      },
      // 空闲连接超时关闭，释放资源
      connectionTimeout: 5_000,
      // 请求 ID 生成：优先使用上游传入的 X-Request-Id，否则生成 UUID
      genReqId: createRequestIdGenerator(),
    }),
    // rawBody 全局关闭：仅微信支付回调路由需要原始请求体用于签名校验，
    // 通过 setupRawBodyForWechatCallback() 在该路由上按需注入，
    // 避免所有请求都保留 rawBody buffer 的内存开销。
    { rawBody: false },
  );

  // 仅对微信支付回调路由注入 rawBody（签名校验需要原始请求体）
  setupRawBodyForWechatCallback(app);

  // 不再注册全局自定义 replySerializer。
  //
  // Fastify 默认的序列化路径（fast-json-stringify / JSON.stringify）
  // 在不传入 replacer 函数时可获得 V8 原生优化。
  //
  // 数据层已确保所有 BigInt/Decimal 在到达响应层前被显式转为
  // number/string（参见 Money.fromDbCents().toOutputYuan() 等），
  // 因此无需全局 replacer 兆底。
  //
  // 若后续新增接口遗漏了 Decimal 转换，将抛出 TypeError，
  // 应在数据层而非序列化层修复。
  await registerGlobalPlugins(app);

  const configService = app.get(ConfigService);
  if (isProduction) {
    validateProductionConfiguration(configService);
  } else {
    // 非生产环境也检查关键安全配置，防止误连生产数据库时使用默认密钥
    const jwtSecret = (configService.get<string>('jwt.secret') ?? '').trim();
    if (!jwtSecret || jwtSecret === 'secret') {
      console.warn(
        '[bootstrap] ⚠️ jwt.secret 仍在使用默认值 "secret"，任何知道该值的人都可以伪造 JWT token。' +
          '请尽快在 .env 中设置 JWT_SECRET 为强随机字符串。',
      );
    }
  }
  app.setGlobalPrefix('api');

  const corsOrigin = configService.get<string>('app.corsOrigin') ?? '*';
  app.enableCors({
    origin: resolveCorsOrigin(corsOrigin),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Requested-With',
      'Wechatpay-Timestamp',
      'Wechatpay-Nonce',
      'Wechatpay-Signature',
      'Wechatpay-Serial',
      'Wechatpay-Signature-Type',
    ],
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

  // 启用优雅关闭：监听 SIGTERM/SIGINT，等待活跃请求完成后再退出
  app.enableShutdownHooks();

  logBootstrapResult({
    listeningPort,
    preferredPort,
    isProduction,
    swaggerEnabled,
  });
}
