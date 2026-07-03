export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private drainResolve: (() => void) | null = null;

  constructor(private readonly concurrency: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async (): Promise<void> => {
        this.active += 1;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.active -= 1;
          if (this.active === 0 && this.queue.length === 0) {
            this.drainResolve?.();
            this.drainResolve = null;
          } else {
            const next = this.queue.shift();
            if (next) {
              next();
            }
          }
        }
      };

      if (this.active < this.concurrency) {
        void execute();
      } else {
        this.queue.push(() => {
          void execute();
        });
      }
    });
  }

  async drain(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }
}

export function countPipelineDeleted(
  results: Array<[Error | null, unknown]> | null,
): number {
  if (!results) {
    return 0;
  }

  let count = 0;
  for (const [err, value] of results) {
    if (!err && typeof value === 'number') {
      count += value;
    }
  }
  return count;
}
