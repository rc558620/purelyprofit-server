import { settleClubTasksInOrder } from './club-parallel-settle.helper';

describe('settleClubTasksInOrder', () => {
  it('并行启动：后一个任务不必等前一个完成', async () => {
    const started: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = (async (): Promise<number> => {
      started.push('first');
      await firstGate;
      return 1;
    })();
    const second = ((): Promise<number> => {
      started.push('second');
      // 第二个任务在第一个完成之前就已启动
      expect(started).toEqual(['first', 'second']);
      releaseFirst();
      return Promise.resolve(2);
    })();

    await expect(settleClubTasksInOrder([first, second])).resolves.toEqual([
      1, 2,
    ]);
  });

  it('按声明顺序返回结果', async () => {
    const result = await settleClubTasksInOrder([
      Promise.resolve('a'),
      Promise.resolve(42),
      Promise.resolve(true),
    ]);

    expect(result).toEqual(['a', 42, true]);
  });

  it('多个失败时抛出声明顺序中的第一个（与串行 await 同语义）', async () => {
    const rejected = settleClubTasksInOrder([
      Promise.reject(new Error('first-failed')),
      Promise.reject(new Error('second-failed')),
    ]);

    await expect(rejected).rejects.toThrow('first-failed');
  });

  it('后置任务失败不会让前置成功值丢失语义：整体失败并抛出该失败', async () => {
    const rejected = settleClubTasksInOrder([
      Promise.resolve('ok'),
      Promise.reject(new Error('late-failed')),
    ]);

    await expect(rejected).rejects.toThrow('late-failed');
  });

  it('失败分支不会留下未处理的 rejection（等全部落地后才抛出）', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);

    try {
      await expect(
        settleClubTasksInOrder([
          Promise.reject(new Error('boom')),
          // 慢一点落地、且同样失败：必须被 allSettled 接住
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('slow-boom')), 20);
          }),
        ]),
      ).rejects.toThrow('boom');
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off('unhandledRejection', listener);
    }

    expect(unhandled).toEqual([]);
  });
});
