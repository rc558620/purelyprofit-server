import { CUSTODY_EXPIRING_SOON_DAYS } from '../../purely-profit/operations/custody/custody.constants';
import { ClubCustodyReadService } from './club-custody-read.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';

const STORE_ID = 21;
const MEMBER_ID = 303;
const NOW = new Date('2026-06-12T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('ClubCustodyReadService 汇总聚合', () => {
  const prisma = {
    member: { findFirst: jest.fn() },
    custodyOrder: { findMany: jest.fn() },
    custodyPickup: { aggregate: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const custodyCodeService = {
    readMemberSummary: jest.fn(),
    writeMemberSummary: jest.fn(),
  };

  const service = new ClubCustodyReadService(
    prisma as never,
    custodyCodeService as never,
  );

  const context = {
    store: { id: STORE_ID, name: '三里屯店' },
    user: { id: 1, phone: '13800000000' },
  } as unknown as ClubCurrentContext;

  const aggregateRow = (overrides: Record<string, unknown> = {}) => ({
    storedCount: 3,
    nextExpiring: new Date(NOW.getTime() + 2 * DAY_MS),
    pendingCount: 2,
    expiringCount: 1,
    nextEnteringWindow: new Date(NOW.getTime() + 20 * DAY_MS),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    prisma.member.findFirst.mockResolvedValue({ id: MEMBER_ID });
    prisma.custodyOrder.findMany.mockResolvedValue([]);
    prisma.custodyPickup.aggregate.mockResolvedValue({
      _sum: { qty: 9 },
    });
    prisma.$queryRaw.mockResolvedValue([aggregateRow()]);
    custodyCodeService.readMemberSummary.mockResolvedValue(null);
    custodyCodeService.writeMemberSummary.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('一次 FILTER 聚合 + 一次取件求和，共 2 条查询（原 5 条）', async () => {
    await service.listOrders(context, { limit: 20, keyword: '' } as never);

    // custody_orders 侧只剩一条原生聚合；count / aggregate / findFirst 都不再调用
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.custodyPickup.aggregate).toHaveBeenCalledTimes(1);
    expect(
      (prisma.custodyOrder as Record<string, unknown>).count,
    ).toBeUndefined();
    expect(
      (prisma.custodyOrder as Record<string, unknown>).aggregate,
    ).toBeUndefined();
  });

  it('四个计数值口径不变：在存 / 临期 / 待确认 / 已取件', async () => {
    const result = await service.listOrders(context, {
      limit: 20,
      keyword: '',
    } as never);

    expect(result.summary).toEqual({
      storedCount: 3,
      expiringCount: 1,
      pendingCount: 2,
      pickedCount: 9,
    });
  });

  it('取件数缺失（无取出流水）时按 0 返回', async () => {
    prisma.custodyPickup.aggregate.mockResolvedValue({ _sum: { qty: null } });

    const result = await service.listOrders(context, {
      limit: 20,
      keyword: '',
    } as never);

    expect(result.summary.pickedCount).toBe(0);
  });

  it('口径有效截止时间取两个临界点中更早的那个', async () => {
    const nextExpiring = new Date(NOW.getTime() + 2 * DAY_MS);
    const nextEnteringWindow = new Date(NOW.getTime() + 20 * DAY_MS);
    prisma.$queryRaw.mockResolvedValue([
      aggregateRow({ nextExpiring, nextEnteringWindow }),
    ]);

    await service.listOrders(context, { limit: 20, keyword: '' } as never);

    // 20 天后的存单会在「20 − 临期阈值」天后进入临期窗口，晚于 2 天后的到期时间，
    // 因此临界点仍取 2 天后的到期时间。
    expect(custodyCodeService.writeMemberSummary).toHaveBeenCalledWith(
      STORE_ID,
      MEMBER_ID,
      expect.objectContaining({ validUntil: nextExpiring.toISOString() }),
    );
  });

  it('存单进入临期窗口早于到期时，以窗口临界点截断缓存有效期', async () => {
    const nextExpiring = new Date(NOW.getTime() + 90 * DAY_MS);
    const enteringWindowAt = NOW.getTime() + 3 * DAY_MS;
    prisma.$queryRaw.mockResolvedValue([
      aggregateRow({
        nextExpiring,
        nextEnteringWindow: new Date(
          enteringWindowAt + CUSTODY_EXPIRING_SOON_DAYS * DAY_MS,
        ),
      }),
    ]);

    await service.listOrders(context, { limit: 20, keyword: '' } as never);

    expect(custodyCodeService.writeMemberSummary).toHaveBeenCalledWith(
      STORE_ID,
      MEMBER_ID,
      expect.objectContaining({
        validUntil: new Date(enteringWindowAt).toISOString(),
      }),
    );
  });

  it('没有任何长期/临期边界时 validUntil 为 null（永不漂移）', async () => {
    prisma.$queryRaw.mockResolvedValue([
      aggregateRow({ nextExpiring: null, nextEnteringWindow: null }),
    ]);

    await service.listOrders(context, { limit: 20, keyword: '' } as never);

    expect(custodyCodeService.writeMemberSummary).toHaveBeenCalledWith(
      STORE_ID,
      MEMBER_ID,
      expect.objectContaining({ validUntil: null }),
    );
  });

  it('缓存命中且未过口径有效期时不重复聚合', async () => {
    custodyCodeService.readMemberSummary.mockResolvedValue({
      summary: {
        storedCount: 1,
        expiringCount: 0,
        pendingCount: 0,
        pickedCount: 2,
      },
      validUntil: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });

    const result = await service.listOrders(context, {
      limit: 20,
      keyword: '',
    } as never);

    expect(result.summary.pickedCount).toBe(2);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
