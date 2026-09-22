import { ClientErrorSampler } from './client-errors-sampler';

describe('ClientErrorSampler', () => {
  const WINDOW_MS = 60_000;

  it('窗口内放行前 N 条，超出部分抑制', () => {
    const sampler = new ClientErrorSampler(WINDOW_MS, 3);
    const start = 1_700_000_000_000;

    expect(sampler.acquire('key-a', start).action).toBe('log');
    expect(sampler.acquire('key-a', start + 1).action).toBe('log');
    expect(sampler.acquire('key-a', start + 2).action).toBe('log');
    expect(sampler.acquire('key-a', start + 3).action).toBe('suppress');
    expect(sampler.acquire('key-a', start + 4).action).toBe('suppress');
  });

  it('不同 key 各自独立计数', () => {
    const sampler = new ClientErrorSampler(WINDOW_MS, 1);
    const start = 1_700_000_000_000;

    expect(sampler.acquire('key-a', start).action).toBe('log');
    expect(sampler.acquire('key-a', start).action).toBe('suppress');
    expect(sampler.acquire('key-b', start).action).toBe('log');
  });

  it('窗口过期后重新计数，并带出被抑制总数', () => {
    const sampler = new ClientErrorSampler(WINDOW_MS, 2);
    const start = 1_700_000_000_000;

    sampler.acquire('key-a', start);
    sampler.acquire('key-a', start);
    sampler.acquire('key-a', start);
    expect(sampler.acquire('key-a', start).action).toBe('suppress');

    const nextWindow = sampler.acquire('key-a', start + WINDOW_MS);
    expect(nextWindow.action).toBe('log');
    expect(nextWindow.suppressedSummary).toBe(2);

    // 汇总只在窗口首条输出一次
    expect(
      sampler.acquire('key-a', start + WINDOW_MS + 1).suppressedSummary,
    ).toBeUndefined();
  });

  it('窗口内未被抑制时不产生汇总', () => {
    const sampler = new ClientErrorSampler(WINDOW_MS, 5);
    const start = 1_700_000_000_000;

    sampler.acquire('key-a', start);
    expect(
      sampler.acquire('key-a', start + WINDOW_MS).suppressedSummary,
    ).toBeUndefined();
  });

  it('配额为 0 时不做降噪', () => {
    const sampler = new ClientErrorSampler(WINDOW_MS, 0);
    const start = 1_700_000_000_000;

    for (let index = 0; index < 100; index += 1) {
      expect(sampler.acquire('key-a', start + index).action).toBe('log');
    }
  });

  it('大量不同 key 不会导致跟踪表无限增长', () => {
    const sampler = new ClientErrorSampler(WINDOW_MS, 5);
    const start = 1_700_000_000_000;

    for (let index = 0; index < 20_000; index += 1) {
      sampler.acquire(`key-${index}`, start);
    }

    // 能继续正常工作，且内存占用有界
    expect(sampler.acquire('key-final', start).action).toBe('log');
    expect(
      (sampler as unknown as { buckets: Map<string, unknown> }).buckets.size,
    ).toBeLessThanOrEqual(5000);
  });
});
