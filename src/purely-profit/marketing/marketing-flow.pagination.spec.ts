import { BadRequestException } from '@nestjs/common';
import { decodeMarketingFlowCursor } from './marketing-flow.cursor';
import {
  at,
  CURSOR_CONDITION,
  installFlowTableMock,
  pointsDataset,
  rechargeDataset,
} from './marketing-flow.query.fixture';
import {
  createMarketingServiceTestingContext,
  type MarketingServiceTestingContext,
} from './marketing.service.test-setup';

describe('营销流水列表游标分页（/marketing/recharges、/marketing/points-records）', () => {
  let context: MarketingServiceTestingContext;

  beforeEach(async () => {
    context = await createMarketingServiceTestingContext();
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /marketing/recharges', () => {
    it('同 created_at 多条翻页不漏不重，且逐页满足 hasMore === (nextCursor !== null)', async () => {
      const flats = installFlowTableMock(context, rechargeDataset);
      const seen: string[] = [];
      let cursor: string | undefined;

      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await context.service.listRecharges(context.user, {
          storeId: 18,
          pageSize: 2,
          cursor,
        });

        seen.push(...page.items.map((item) => item.id));
        expect(page.hasMore).toBe(page.nextCursor !== null);
        // total 恒为与筛选同源的全量口径，不随游标推进而缩水
        expect(page.meta.total).toBe(rechargeDataset.length);

        if (!page.nextCursor) {
          break;
        }
        cursor = page.nextCursor;
      }

      expect(seen).toEqual(['6', '5', '4', '3', '2', '1']);
      expect(new Set(seen).size).toBe(rechargeDataset.length);
      // 首页走 offset，其后每一步都靠游标条件定位，不再依赖 OFFSET 深翻页
      expect(flats[0]?.text).toContain('OFFSET');
      expect(flats.some((flat) => CURSOR_CONDITION.test(flat.text))).toBe(true);
      expect(
        flats.slice(1).every((flat) => !flat.text.includes('OFFSET')),
      ).toBe(true);
    });

    it('末页 nextCursor 为 null 且 hasMore 为 false', async () => {
      installFlowTableMock(context, rechargeDataset);
      const firstPage = await context.service.listRecharges(context.user, {
        storeId: 18,
        pageSize: 2,
      });
      const secondPage = await context.service.listRecharges(context.user, {
        storeId: 18,
        pageSize: 2,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(firstPage.items.map((item) => item.id)).toEqual(['6', '5']);
      expect(secondPage.items.map((item) => item.id)).toEqual(['4', '3']);
      expect(secondPage.hasMore).toBe(true);

      const lastPage = await context.service.listRecharges(context.user, {
        storeId: 18,
        pageSize: 2,
        cursor: secondPage.nextCursor ?? undefined,
      });

      expect(lastPage.items.map((item) => item.id)).toEqual(['2', '1']);
      expect(lastPage.hasMore).toBe(false);
      expect(lastPage.nextCursor).toBeNull();
      // 到底后 total 仍是全量口径，前端不会因为翻到底而看到总数缩水
      expect(lastPage.meta.total).toBe(rechargeDataset.length);
    });

    it('nextCursor 指向本页最后一行（探测行不外泄）', async () => {
      installFlowTableMock(context, rechargeDataset);
      const page = await context.service.listRecharges(context.user, {
        storeId: 18,
        pageSize: 2,
      });

      expect(page.items.map((item) => item.id)).toEqual(['6', '5']);
      expect(decodeMarketingFlowCursor(page.nextCursor)).toEqual({
        createdAt: at('2026-05-15T09:00:00.000Z'),
        id: 5,
      });
    });

    it('非法 cursor 直接 400，且不发起列表查询', async () => {
      const flats = installFlowTableMock(context, rechargeDataset);

      await expect(
        context.service.listRecharges(context.user, {
          storeId: 18,
          cursor: 'not-a-valid-cursor',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(flats).toEqual([]);
      expect(context.prismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('offset 兼容路径：语义、meta 与取数成本都不变（仍是单条 COUNT(*) OVER() 查询）', async () => {
      const flats = installFlowTableMock(context, rechargeDataset);

      const page = await context.service.listRecharges(context.user, {
        storeId: 18,
        page: 2,
        pageSize: 2,
      });

      expect(page.items.map((item) => item.id)).toEqual(['4', '3']);
      expect(page.meta).toEqual({
        page: 2,
        pageSize: 2,
        total: rechargeDataset.length,
        totalPages: 3,
      });
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();
      // 只有一条 SQL、且带 OFFSET：没有额外 count 往返
      expect(flats).toHaveLength(1);
      expect(flats[0]?.text).toContain('OFFSET');
      expect(flats[0]?.text).toContain('COUNT(*) OVER()');
    });

    it('offset 路径最后一页：hasMore 由 total 推导为 false', async () => {
      installFlowTableMock(context, rechargeDataset);

      const page = await context.service.listRecharges(context.user, {
        storeId: 18,
        page: 3,
        pageSize: 2,
      });

      expect(page.items.map((item) => item.id)).toEqual(['2', '1']);
      expect(page.meta.total).toBe(6);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();

      const beyond = await context.service.listRecharges(context.user, {
        storeId: 18,
        page: 4,
        pageSize: 2,
      });
      expect(beyond.items).toEqual([]);
      expect(beyond.hasMore).toBe(false);
      expect(beyond.nextCursor).toBeNull();
    });
  });

  describe('GET /marketing/points-records', () => {
    it('同 created_at 多条翻页不漏不重，且 total 保持全量口径', async () => {
      const flats = installFlowTableMock(context, pointsDataset);
      const seen: string[] = [];
      let cursor: string | undefined;

      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await context.service.listPointsRecords(context.user, {
          storeId: 18,
          pageSize: 1,
          cursor,
        });

        seen.push(...page.items.map((item) => item.id));
        expect(page.hasMore).toBe(page.nextCursor !== null);
        expect(page.meta.total).toBe(pointsDataset.length);

        if (!page.nextCursor) {
          break;
        }
        cursor = page.nextCursor;
      }

      expect(seen).toEqual(['4', '3', '2', '1']);
      expect(new Set(seen).size).toBe(pointsDataset.length);
      expect(flats.some((flat) => CURSOR_CONDITION.test(flat.text))).toBe(true);
    });

    it('末页 nextCursor 为 null 且 hasMore 为 false', async () => {
      installFlowTableMock(context, pointsDataset);

      const page = await context.service.listPointsRecords(context.user, {
        storeId: 18,
        pageSize: 10,
      });

      expect(page.items.map((item) => item.id)).toEqual(['4', '3', '2', '1']);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('非法 cursor 直接 400，且不发起列表查询', async () => {
      const flats = installFlowTableMock(context, pointsDataset);

      await expect(
        context.service.listPointsRecords(context.user, {
          storeId: 18,
          cursor: 'v1:bm90LWpzb24',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(flats).toEqual([]);
      expect(context.prismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('offset 兼容路径：仍带 OFFSET 且不额外发 count', async () => {
      const flats = installFlowTableMock(context, pointsDataset);

      const page = await context.service.listPointsRecords(context.user, {
        storeId: 18,
        page: 1,
        pageSize: 2,
      });

      expect(page.items.map((item) => item.id)).toEqual(['4', '3']);
      expect(page.meta).toEqual({
        page: 1,
        pageSize: 2,
        total: 4,
        totalPages: 2,
      });
      expect(page.hasMore).toBe(true);
      expect(flats).toHaveLength(1);
      expect(flats[0]?.text).toContain('OFFSET');
    });
  });
});
