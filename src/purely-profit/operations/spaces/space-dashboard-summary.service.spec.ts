/**
 * 空间看板今日统计单测：todaySettled 统计所有今日销售单；
 * todayRevenue 与销售记录页同口径（从 sale_order_items 聚合实际消费，
 * 排除预付款/续费抵扣负项行并扣除退款），避免「预付 > 消费」结账单拉低营业额。
 */
import { SpaceDashboardSummaryService } from './space-dashboard-summary.service';
import { aggregateOrderStats } from '../sales-record/sales-record.query';

jest.mock('../sales-record/sales-record.query', () => ({
  aggregateOrderStats: jest.fn(),
}));

describe('SpaceDashboardSummaryService.buildTodaySettledSessionStats', () => {
  let service: SpaceDashboardSummaryService;
  let countMock: jest.Mock;
  const aggregateMock = aggregateOrderStats as jest.MockedFunction<
    typeof aggregateOrderStats
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    countMock = jest.fn();
    service = new SpaceDashboardSummaryService({
      saleOrder: { count: countMock },
    } as never);
  });

  it('营业额复用销售记录页口径聚合，结账次数统计所有今日销售单', async () => {
    countMock.mockResolvedValue(5);
    aggregateMock.mockResolvedValue({
      totalRevenue: 2675,
      totalProfit: 1000,
      orderCount: 5,
    });

    const result = await service.buildTodaySettledSessionStats(42);

    expect(result).toEqual({ todaySettled: 5, todayRevenue: 2675 });
    expect(countMock).toHaveBeenCalledWith({
      where: {
        storeId: 42,
        date: {
          gte: expect.any(Date),
          lte: expect.any(Date),
        },
      },
    });
    expect(aggregateMock).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    );
  });

  it('无今日销售单时营业额回落 0', async () => {
    countMock.mockResolvedValue(0);
    aggregateMock.mockResolvedValue({
      totalRevenue: 0,
      totalProfit: 0,
      orderCount: 0,
    });

    const result = await service.buildTodaySettledSessionStats(42);

    expect(result).toEqual({ todaySettled: 0, todayRevenue: 0 });
  });
});
