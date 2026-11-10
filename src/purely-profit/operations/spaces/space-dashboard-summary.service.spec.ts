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

describe('SpaceDashboardSummaryService.buildDashboardSpaceSummaryBundle', () => {
  const sessionFindMany = jest.fn();
  const reservationFindMany = jest.fn();
  let service: SpaceDashboardSummaryService;

  const buildActiveSessionRow = (overrides: Record<string, unknown> = {}) => ({
    id: 7,
    spaceId: 3,
    guestName: '张三',
    guestPhone: null,
    guestCount: 2,
    billingMode: 'countdown',
    startTime: new Date('2026-11-10T10:00:00+08:00'),
    hourlyRate: null,
    countdownMinutes: 120,
    itemsCost: 0,
    _count: { sessionRenewRecords: 2 },
    autoCheckout: true,
    prepaidPaymentMethod: 'cash',
    prepaidGrouponCode: null,
    prepaidNote: null,
    prepaidAmount: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    reservationFindMany.mockResolvedValue([]);
    service = new SpaceDashboardSummaryService({
      spaceSession: { findMany: sessionFindMany },
      spaceReservation: { findMany: reservationFindMany },
    } as never);
  });

  it('active 会话只取续费计数，renewCount 与续费行数等价', async () => {
    sessionFindMany.mockResolvedValue([buildActiveSessionRow()]);

    const bundle = await service.buildDashboardSpaceSummaryBundle(42);

    expect(sessionFindMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ storeId: 42 }),
      select: {
        id: true,
        spaceId: true,
        guestName: true,
        guestPhone: true,
        guestCount: true,
        billingMode: true,
        startTime: true,
        hourlyRate: true,
        countdownMinutes: true,
        itemsCost: true,
        _count: { select: { sessionRenewRecords: true } },
        autoCheckout: true,
        prepaidPaymentMethod: true,
        prepaidGrouponCode: true,
        prepaidNote: true,
        prepaidAmount: true,
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });
    expect(bundle.activeSessionSummaryBySpaceId.get(3)).toEqual(
      expect.objectContaining({ sessionId: '7', renewCount: 2 }),
    );
  });

  it('同一空间多个 active 会话仍只保留首个，续费计数为 0 时原样返回 0', async () => {
    sessionFindMany.mockResolvedValue([
      buildActiveSessionRow({ id: 9, _count: { sessionRenewRecords: 0 } }),
      buildActiveSessionRow({ id: 8, _count: { sessionRenewRecords: 5 } }),
    ]);

    const bundle = await service.buildDashboardSpaceSummaryBundle(42);

    expect(bundle.activeSessionSummaryBySpaceId.size).toBe(1);
    expect(bundle.activeSessionSummaryBySpaceId.get(3)).toEqual(
      expect.objectContaining({ sessionId: '9', renewCount: 0 }),
    );
  });
});
