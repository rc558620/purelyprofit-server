import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CachePrewarmCycleService } from './cache-prewarm-cycle.service';
import { CachePrewarmService } from './cache-prewarm.service';

describe('CachePrewarmService', () => {
  let service: CachePrewarmService;

  const configService = {
    get: jest.fn((key: string) => {
      const configMap: Record<string, number | boolean> = {
        'app.cachePrewarmEnabled': true,
        'app.cachePrewarmIntervalMs': 60_000,
        'app.cachePrewarmInitialDelayMs': 1_000,
        'app.cachePrewarmBatchSize': 10,
        'app.cachePrewarmConcurrency': 2,
        'app.cachePrewarmLogEnabled': true,
        'app.cachePrewarmLogSampleEvery': 20,
        'app.cachePrewarmSlowCycleThresholdMs': 1_500,
      };
      return configMap[key];
    }),
  };

  const cycleService = {
    runCycle: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachePrewarmService,
        { provide: ConfigService, useValue: configService },
        { provide: CachePrewarmCycleService, useValue: cycleService },
      ],
    }).compile();

    service = module.get<CachePrewarmService>(CachePrewarmService);
  });

  afterEach(() => {
    jest.useRealTimers();
    service.onModuleDestroy();
  });

  it('启动后会按初始延迟和周期调度预热任务', async () => {
    service.onModuleInit();

    expect(cycleService.runCycle).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);

    expect(cycleService.runCycle).toHaveBeenNthCalledWith(1, {
      cycleId: 1,
      batchSize: 10,
      concurrency: 2,
      logEnabled: true,
      logSampleEvery: 20,
      slowCycleThresholdMs: 1_500,
    });

    await jest.advanceTimersByTimeAsync(60_000);

    expect(cycleService.runCycle).toHaveBeenNthCalledWith(2, {
      cycleId: 2,
      batchSize: 10,
      concurrency: 2,
      logEnabled: true,
      logSampleEvery: 20,
      slowCycleThresholdMs: 1_500,
    });
  });

  it('上一次 cycle 未结束时不会重复触发下一轮', async () => {
    let resolveCycle: (() => void) | null = null;
    cycleService.runCycle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCycle = resolve;
        }),
    );

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(cycleService.runCycle).toHaveBeenCalledTimes(1);

    resolveCycle?.();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(cycleService.runCycle).toHaveBeenCalledTimes(2);
  });

  it('禁用时不会注册预热定时器', () => {
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number | boolean> = {
        'app.cachePrewarmEnabled': false,
        'app.cachePrewarmIntervalMs': 60_000,
        'app.cachePrewarmInitialDelayMs': 1_000,
        'app.cachePrewarmBatchSize': 10,
        'app.cachePrewarmConcurrency': 2,
        'app.cachePrewarmLogEnabled': true,
        'app.cachePrewarmLogSampleEvery': 20,
        'app.cachePrewarmSlowCycleThresholdMs': 1_500,
      };
      return configMap[key];
    });

    const disabledService = new CachePrewarmService(
      configService as unknown as ConfigService,
      cycleService as unknown as CachePrewarmCycleService,
    );

    disabledService.onModuleInit();
    jest.advanceTimersByTime(61_000);

    expect(cycleService.runCycle).not.toHaveBeenCalled();
    disabledService.onModuleDestroy();
  });

  it('销毁时会清理已注册的定时器', async () => {
    service.onModuleInit();
    service.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(61_000);

    expect(cycleService.runCycle).not.toHaveBeenCalled();
  });
});
