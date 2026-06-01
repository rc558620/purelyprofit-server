import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn(),
  },
}));

describe('main bootstrap', () => {
  const createMock = NestFactory.create as jest.MockedFunction<
    typeof NestFactory.create
  >;

  const app = {
    useGlobalPipes: jest.fn(),
    setGlobalPrefix: jest.fn(),
    enableCors: jest.fn(),
    get: jest.fn(),
    getHttpAdapter: jest.fn(() => ({
      getInstance: () => ({
        addHook: jest.fn(),
      }),
    })),
    listen: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    delete require.cache[require.resolve('./main')];
    app.useGlobalPipes.mockClear();
    app.setGlobalPrefix.mockClear();
    app.enableCors.mockClear();
    app.get.mockClear();
    app.listen.mockClear();
    createMock.mockResolvedValue(app as never);
  });

  it('会把 Fastify 运行时参数传给适配器', async () => {
    const bootstrapConfig = {
      get: jest.fn((key: string) => {
        const configMap: Record<string, string | number | boolean> = {
          nodeEnv: 'production',
          'app.logEnabled': false,
          'app.httpBodyLimitBytes': 1024,
          'app.httpKeepAliveTimeoutMs': 70000,
          'app.httpRequestTimeoutMs': 12000,
          'app.corsOrigin': '*',
          'app.slowRequestLogEnabled': false,
          'app.slowRequestThresholdMs': 800,
          'app.swaggerEnabled': false,
          port: 3000,
        };
        return configMap[key];
      }),
    };
    const runtimeConfig = {
      get: bootstrapConfig.get,
    };

    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(bootstrapConfig.get);
    app.get.mockImplementation((token: unknown) => {
      if (token === ConfigService) {
        return runtimeConfig;
      }
      return undefined;
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./main');
    await new Promise((resolve) => setImmediate(resolve));

    expect(createMock).toHaveBeenCalledTimes(1);
    const adapterOptions = createMock.mock.calls[0]?.[1] as unknown as {
      instance?: { initialConfig?: Record<string, unknown> };
    };
    expect(adapterOptions.instance?.initialConfig).toMatchObject({
      bodyLimit: 1024,
      keepAliveTimeout: 70000,
      requestTimeout: 12000,
    });
    expect(app.listen).toHaveBeenCalledWith(3000, '0.0.0.0');
  });
});
