import { Test, TestingModule } from '@nestjs/testing';
import { CachePrewarmService } from './cache-prewarm.service';

/**
 * CachePrewarmService 测试套件（已迁移到 BullMQ）
 *
 * 注意：原 setInterval 调度逻辑已迁移到 BullMQ，
 * 当前测试仅验证兼容层正常启动。
 *
 * BullMQ 相关测试见：
 * - src/queue/cache-prewarm.processor.spec.ts（TBD）
 * - src/queue/queue-scheduler.service.spec.ts（TBD）
 */
describe('CachePrewarmService (Legacy Compat Layer)', () => {
  let service: CachePrewarmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CachePrewarmService],
    }).compile();

    service = module.get<CachePrewarmService>(CachePrewarmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delegate to BullMQ on module init', () => {
    const logSpy = jest.spyOn(service['logger'], 'log');
    service.onModuleInit();
    expect(logSpy).toHaveBeenCalledWith(
      '[cache-prewarm] scheduling delegated to BullMQ (QueueModule)',
    );
  });

  it('should return resolved promise for waitForRunningCycle', async () => {
    await expect(service.waitForRunningCycle()).resolves.toBeUndefined();
  });
});
