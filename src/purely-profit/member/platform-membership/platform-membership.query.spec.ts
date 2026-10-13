import { loadDbNowMs } from './platform-membership.query';

describe('loadDbNowMs', () => {
  const buildExecutor = (rows: unknown): { $queryRaw: jest.Mock } => ({
    $queryRaw: jest.fn().mockResolvedValue(rows),
  });

  it('返回 DB 当前时间戳（ms）', async () => {
    const dbNow = new Date('2026-10-12T04:00:00.000Z');
    const executor = buildExecutor([{ now: dbNow }]);

    await expect(loadDbNowMs(executor as never)).resolves.toBe(dbNow.getTime());
  });

  it('查询结果为空时返回 null', async () => {
    await expect(loadDbNowMs(buildExecutor([]) as never)).resolves.toBeNull();
  });

  it('查询返回不可解析的时间时返回 null，不把 NaN 传给调用方', async () => {
    // NaN 一旦参与 `expiresAt > nowMs` 比较恒为 false，会让所有档案都被判过期
    await expect(
      loadDbNowMs(buildExecutor([{ now: new Date('invalid') }]) as never),
    ).resolves.toBeNull();
  });

  it('查询抛错时返回 null，由调用方回落到应用时钟', async () => {
    const executor = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('down')),
    };

    await expect(loadDbNowMs(executor as never)).resolves.toBeNull();
  });

  it('查询用的 NOW() 是只读，不写入任何字段', async () => {
    // 写入口径（NOW() 必须带 AT TIME ZONE 'UTC'）由 scripts/check-sql-timezone.mjs
    // 把关；这里只确认读路径不会因为该检查而被迫改写
    const executor = buildExecutor([]);

    await loadDbNowMs(executor as never);

    const sql = String(executor.$queryRaw.mock.calls[0][0]);
    expect(sql).toMatch(/SELECT\s+NOW\(\)/i);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });
});
