// 打印任务状态：明确失败可重试、已下发/结果未知不重复出票、Redis 故障时不漏打
import { RedisService } from '../../../redis/redis.service';
import { ScanOrderingPrintTaskService } from './scan-ordering-print-task.service';

describe('ScanOrderingPrintTaskService', () => {
  const redisService = {
    evalScript: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  };
  let service: ScanOrderingPrintTaskService;

  const taskKey = { storeId: 11, orderId: 66, target: 'kitchen' as const };
  const autoKey = 'scanordering:print-task:11:66:kitchen:auto';
  const manualKey = 'scanordering:print-task:11:66:kitchen:manual';

  const buildState = (
    overrides: Partial<{
      taskId: string;
      status: string;
      source: string;
      upstreamId: string | null;
      error: string | null;
      updatedAt: number;
    }> = {},
  ): string =>
    JSON.stringify({
      taskId: 'task-1',
      status: 'pending',
      source: 'auto',
      upstreamId: null,
      error: null,
      updatedAt: Date.now(),
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScanOrderingPrintTaskService(
      redisService as unknown as RedisService,
    );
    redisService.set.mockResolvedValue(undefined);
    redisService.evalScript.mockResolvedValue(1);
  });

  it('首次自动打印原子抢占名额，pending 用短租约（进程中断不会拦 7 天）', async () => {
    const gate = await service.beginAuto(taskKey);

    expect(gate.acquired).toBe(true);
    expect(gate.state.status).toBe('pending');
    const [script, keys, args] = redisService.evalScript.mock.calls[0];
    expect(script).toContain("state['status'] ~= 'failed'");
    expect(keys).toEqual([autoKey]);
    expect(args[1]).toBe(String(60 * 1000));
  });

  it('已下发的任务不重复抢占', async () => {
    redisService.evalScript.mockResolvedValue(0);
    redisService.get.mockResolvedValue(
      buildState({
        taskId: 'feie-1',
        status: 'dispatched',
        upstreamId: 'feie-1',
      }),
    );

    const gate = await service.beginAuto(taskKey);

    expect(gate.acquired).toBe(false);
    expect(gate.state.status).toBe('dispatched');
    expect(gate.state.upstreamId).toBe('feie-1');
  });

  it('上次明确失败时允许重试（由原子脚本判定，不再先读后写）', async () => {
    redisService.evalScript.mockResolvedValue(1);

    const gate = await service.beginAuto(taskKey);

    expect(gate.acquired).toBe(true);
    expect(gate.state.status).toBe('pending');
  });

  it('两个终端并发重试同一失败任务时只有一个能拿到名额', async () => {
    // 脚本在服务端原子执行：第一个请求写入 pending，第二个读到 pending 返回 0
    redisService.evalScript
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    redisService.get.mockResolvedValue(buildState({ status: 'pending' }));

    const [first, second] = await Promise.all([
      service.beginAuto(taskKey),
      service.beginAuto(taskKey),
    ]);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
  });

  it('Redis 不可用时不阻断打印（按未打印处理）', async () => {
    redisService.evalScript.mockRejectedValue(new Error('redis down'));

    const gate = await service.beginAuto(taskKey);

    expect(gate.acquired).toBe(true);
    expect(gate.state.status).toBe('pending');
  });

  it('人工补打写独立桶，不覆盖自动打印的去重记录', async () => {
    await service.markPending(taskKey, 'manual', 'manual-task-1');

    expect(redisService.set).toHaveBeenCalledWith(
      manualKey,
      expect.stringContaining('"source":"manual"'),
      7 * 24 * 60 * 60,
    );
    // 自动桶未被写入：一次失败的补打不会把已成功的自动任务改成 failed
    const writtenKeys = redisService.set.mock.calls.map((call) => call[0]);
    expect(writtenKeys).not.toContain(autoKey);
  });

  it('终态写入按 taskId 条件更新，租约过期后的迟到结果不覆盖新一轮', async () => {
    await service.markDispatched(taskKey, 'auto', 'task-1', 'feie-1');

    const [script, keys, args] = redisService.evalScript.mock.calls[0];
    expect(script).toContain("state['taskId'] ~= ARGV[2]");
    expect(keys).toEqual([autoKey]);
    expect(args[1]).toBe('task-1');
    expect(args[0]).toContain('"status":"dispatched"');
  });

  it('结果未知只保留短窗口，避免长时间拦截重试', async () => {
    await service.markUnknown(taskKey, 'auto', 'task-1', '云打印请求超时');

    const [, keys, args] = redisService.evalScript.mock.calls[0];
    expect(keys).toEqual([autoKey]);
    expect(args[0]).toContain('"status":"unknown"');
    expect(args[2]).toBe(String(10 * 60 * 1000));
  });

  it('明确失败保留原因供设置页展示', async () => {
    await service.markFailed(taskKey, 'auto', 'task-1', '打印代理未连接');

    const [, , args] = redisService.evalScript.mock.calls[0];
    expect(args[0]).toContain('打印代理未连接');
    expect(args[2]).toBe(String(7 * 24 * 60 * 60 * 1000));
  });

  it('状态查询取自动/人工两桶中较新的一条', async () => {
    redisService.get.mockImplementation((key: string) =>
      Promise.resolve(
        key === autoKey
          ? buildState({ status: 'dispatched', updatedAt: 1000 })
          : buildState({
              status: 'failed',
              source: 'manual',
              error: '补打失败',
              updatedAt: 2000,
            }),
      ),
    );

    const state = await service.getLatestState(taskKey);

    expect(state?.status).toBe('failed');
    expect(state?.source).toBe('manual');
  });

  it('读取不到记录时返回 null', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(service.getLatestState(taskKey)).resolves.toBeNull();
  });
});
