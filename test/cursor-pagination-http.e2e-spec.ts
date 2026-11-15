/**
 * 游标分页 HTTP 层验证（guard / ValidationPipe / 响应序列化全链路）。
 *
 * 上一轮 test/cursor-pagination-real-db.e2e-spec.ts 直接调 service + 真实 Prisma，
 * 绕过了 JwtAuthGuard、PermissionsGuard、ValidationPipe 与响应序列化，
 * 因此「cursor 的 @MaxLength(256)、whitelist 剥离、400 的错误体形态」至今没有
 * 端到端证据。本用例补齐这一段，覆盖契约里的每条 HTTP 断言：
 *
 *   1. 不带 cursor → 200，含 items / meta / hasMore / nextCursor 且 total 存在；
 *   2. 合法 cursor → 200，本页 id 不与第一页重复；
 *   3. 非法 cursor（v1:broken）→ 400，错误体不含 SQL / 堆栈；
 *   4. 超 256 字符 cursor → 400（@MaxLength 确实生效，未被 whitelist 静默丢弃）；
 *   5. offset 兼容 ?page=1&pageSize=2 → 200，结构与游标路径一致；
 *   6. 同排序值多行 → 翻页序列与一次拉取一致、无重复、末页 nextCursor 为 null。
 *
 * 运行：node --experimental-vm-modules node_modules/jest/bin/jest.js \
 *        --config ./test/jest-e2e.json --runInBand cursor-pagination-http
 */
import {
  bootstrapCursorHttpApp,
  get,
  hasUsableStore,
  PAGE_SIZE,
  SCENARIOS,
  SEED_COUNT,
  teardownCursorHttpApp,
  type CursorPageBody,
} from './cursor-http.fixture';

jest.setTimeout(120_000);

describe('游标分页 HTTP 层验证（现金流水 / 销售订单）', () => {
  beforeAll(async () => {
    await bootstrapCursorHttpApp();
  }, 120_000);

  afterAll(async () => {
    await teardownCursorHttpApp();
  }, 120_000);

  describe.each(SCENARIOS)('$name', (scenario) => {
    it('不带 cursor：200，响应含 items/meta/hasMore/nextCursor 且 total 存在', async () => {
      if (!hasUsableStore()) {
        console.warn('[skip] 库里没有可用门店，游标 HTTP 验证跳过');
        return;
      }

      const { body } = await get(scenario.path({ pageSize: PAGE_SIZE }))
        .expect(200)
        .expect('Content-Type', /json/);

      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items).toHaveLength(PAGE_SIZE);
      expect(body.meta.total).toBe(SEED_COUNT);
      expect(body.hasMore).toBe(true);
      expect(typeof body.nextCursor).toBe('string');
      // 恒等式：hasMore 必须与 nextCursor 同源
      expect(body.hasMore).toBe(body.nextCursor !== null);
    });

    it('合法 cursor：200，且本页 id 不与第一页重复', async () => {
      if (!hasUsableStore()) {
        return;
      }

      const first = await get(scenario.path({ pageSize: PAGE_SIZE })).expect(
        200,
      );
      const second = await get(
        scenario.path({ pageSize: PAGE_SIZE, cursor: first.body.nextCursor }),
      ).expect(200);

      const firstIds: string[] = first.body.items.map(
        (item: { id: string }) => item.id,
      );
      const secondIds: string[] = second.body.items.map(
        (item: { id: string }) => item.id,
      );
      expect(secondIds).toHaveLength(PAGE_SIZE);
      // total 是「与筛选同源、不含游标」的全量口径，翻页过程中不能变小
      expect(second.body.meta.total).toBe(SEED_COUNT);
      expect(new Set([...firstIds, ...secondIds]).size).toBe(
        firstIds.length + secondIds.length,
      );
    });

    it('非法 cursor（v1:broken）：400，且错误体不泄露 SQL / 堆栈', async () => {
      if (!hasUsableStore()) {
        return;
      }

      const { body } = await get(scenario.path({ cursor: 'v1:broken' }))
        .expect(400)
        .expect('Content-Type', /json/);

      expect(JSON.stringify(body.message)).toContain('cursor');
      // 错误体必须是稳定契约：不含 SQL 片段、数据库内部信息与调用栈
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|ILIKE/i);
      expect(serialized).not.toMatch(/prisma|postgres|\.ts:\d+/i);
      expect(serialized).not.toContain(' at ');
    });

    it('超过 256 字符的 cursor：400（@MaxLength 生效，未被 whitelist 静默丢弃）', async () => {
      if (!hasUsableStore()) {
        return;
      }

      const { body } = await get(
        scenario.path({ cursor: `v1:${'a'.repeat(300)}` }),
      )
        .expect(400)
        .expect('Content-Type', /json/);

      // 必须是 DTO 校验拦下的（消息来自 @MaxLength），而不是静默回第一页
      expect(JSON.stringify(body.message)).toContain('cursor 长度不合法');
    });

    it('offset 兼容：?page=1&pageSize=2 仍 200 且结构与游标路径一致', async () => {
      if (!hasUsableStore()) {
        return;
      }

      const { body } = await get(
        scenario.path({ page: 1, pageSize: PAGE_SIZE }),
      ).expect(200);

      expect(body.items).toHaveLength(PAGE_SIZE);
      expect(body.meta).toMatchObject({
        page: 1,
        pageSize: PAGE_SIZE,
        total: SEED_COUNT,
      });
      expect(body.hasMore).toBe(true);
      expect(typeof body.nextCursor).toBe('string');
    });

    it('翻页序列与一次拉取一致：不漏、不重、末页 nextCursor 为 null', async () => {
      if (!hasUsableStore()) {
        return;
      }

      const oneShot = await get(scenario.path({ pageSize: 100 })).expect(200);
      const expected: string[] = oneShot.body.items.map(
        (item: { id: string }) => item.id,
      );
      expect(expected).toHaveLength(SEED_COUNT);
      expect(oneShot.body.hasMore).toBe(false);
      expect(oneShot.body.nextCursor).toBeNull();

      const walked: string[] = [];
      let cursor: string | null = null;
      let lastPage: CursorPageBody | null = null;
      // 防御：翻页不收敛时立即失败，避免用例挂死
      for (let round = 0; round <= SEED_COUNT + 1; round += 1) {
        const response = await get(
          scenario.path({ pageSize: PAGE_SIZE, cursor: cursor ?? undefined }),
        ).expect(200);
        const page = response.body as CursorPageBody;
        walked.push(...page.items.map((item) => item.id));
        expect(page.meta.total).toBe(SEED_COUNT);
        expect(page.hasMore).toBe(page.nextCursor !== null);
        lastPage = page;
        if (page.nextCursor === null) {
          break;
        }
        cursor = page.nextCursor;
      }

      // 末页必须收敛：hasMore=false 且 nextCursor=null
      expect(lastPage?.hasMore).toBe(false);
      expect(lastPage?.nextCursor).toBeNull();
      expect(walked).toEqual(expected);
      expect(new Set(walked).size).toBe(walked.length);
    });
  });
});
