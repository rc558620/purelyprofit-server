import {
  CLUB_BATCH_DEFAULT_CONCURRENCY,
  runClubBatchWithConcurrency,
} from './club-batch-concurrency.helper';

/**
 * 3-B-7：批处理有限并发执行器。
 *
 * 关注三件事：并发上限真的生效、批次跑完整、单笔异常既不静默也不连坐。
 */
describe('runClubBatchWithConcurrency', () => {
  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const buildTracker = () => {
    let inFlight = 0;
    let peak = 0;
    const processed: number[] = [];

    const handler = async (item: number): Promise<void> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight -= 1;
      processed.push(item);
    };

    return {
      handler,
      getPeak: (): number => peak,
      getProcessed: (): number[] => processed,
    };
  };

  it('在途数量不超过指定并发度，且每一项都被处理', async () => {
    const tracker = buildTracker();
    const items = Array.from({ length: 12 }, (_, index) => index);

    await runClubBatchWithConcurrency(items, tracker.handler, 3);

    expect(tracker.getPeak()).toBe(3);
    expect(tracker.getProcessed().sort((a, b) => a - b)).toEqual(items);
  });

  it('默认并发度生效（不超过 CLUB_BATCH_DEFAULT_CONCURRENCY）', async () => {
    const tracker = buildTracker();
    const items = Array.from({ length: 20 }, (_, index) => index);

    await runClubBatchWithConcurrency(items, tracker.handler);

    expect(tracker.getPeak()).toBe(CLUB_BATCH_DEFAULT_CONCURRENCY);
  });

  it('条目少于并发度时不会空转或多跑', async () => {
    const tracker = buildTracker();

    await runClubBatchWithConcurrency([1, 2], tracker.handler, 5);

    expect(tracker.getPeak()).toBe(2);
    expect(tracker.getProcessed()).toHaveLength(2);
  });

  it('非法并发度回落到串行，不会挂起', async () => {
    const tracker = buildTracker();

    await runClubBatchWithConcurrency([1, 2, 3], tracker.handler, 0);

    expect(tracker.getPeak()).toBe(1);
    expect(tracker.getProcessed()).toHaveLength(3);
  });

  it('空批次不调用处理器', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    await runClubBatchWithConcurrency([], handler);

    expect(handler).not.toHaveBeenCalled();
  });

  it('单笔异常不中断整批，且异常最终抛给调用方（不吞错）', async () => {
    const handled: number[] = [];
    const items = [1, 2, 3, 4];

    const run = runClubBatchWithConcurrency(
      items,
      async (item) => {
        await delay(1);
        handled.push(item);
        if (item === 2) {
          throw new Error(`第 ${item} 笔失败`);
        }
      },
      2,
    );

    await expect(run).rejects.toThrow('第 2 笔失败');
    expect(handled.sort((a, b) => a - b)).toEqual(items);
  });

  it('处理器自行 catch 时整轮不抛错', async () => {
    await expect(
      runClubBatchWithConcurrency(
        [1, 2],
        async () => {
          await delay(1);
          // 单笔失败自行降级（与两个批处理调用方一致）
        },
        2,
      ),
    ).resolves.toBeUndefined();
  });
});
