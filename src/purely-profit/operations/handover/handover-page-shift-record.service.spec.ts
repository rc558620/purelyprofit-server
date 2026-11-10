// 交班班次查询回归用例：未交班班次不得因固定回溯窗口被静默丢弃
import { EmployeeShiftType } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';
import type { HandoverShiftHandoverStatusService } from './handover-shift-handover-status.service';
import type { ShiftRecordRow } from './handover.shared';

describe('HandoverPageShiftRecordService - 未交班班次长期保留', () => {
  /** 上海时间 2026-08-11 的排班（早于修复前的 90 天回溯下界 2026-08-12） */
  const shiftDate = new Date('2026-08-10T16:00:00.000Z');
  /** 上海时间 2026-11-10 10:00，模拟 bug 复现时的服务器时刻 */
  const referenceAt = new Date('2026-11-10T02:00:00.000Z');
  const historicalShift: ShiftRecordRow = {
    id: 2,
    employeeId: 2,
    employeeName: '收银员2',
    shiftType: EmployeeShiftType.custom,
    shiftName: '中班',
    date: shiftDate,
    startTime: '10:12',
    endTime: '10:21',
    createdAt: shiftDate,
  };

  const findMany = jest.fn();
  const findFirst = jest.fn();
  const attachCompletionStatus = jest.fn();
  // 仅替身本用例涉及的 Prisma 与交班状态服务方法，避免启动完整 Nest 容器。
  const prisma = {
    employeeShift: { findMany, findFirst },
  } as unknown as PrismaService;
  const handoverStatus = {
    attachCompletionStatus,
  } as unknown as HandoverShiftHandoverStatusService;
  const service = new HandoverPageShiftRecordService(prisma, handoverStatus);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([historicalShift]);
    findFirst.mockResolvedValue(historicalShift);
    attachCompletionStatus.mockResolvedValue([
      { shift: historicalShift, handedOver: false },
    ]);
  });

  it('超过 90 天的未交班班次仍被选为当前班次，且日期条件不设下界', async () => {
    const result = await service.findCurrentShiftRecord(42, null, referenceAt);

    expect(result).toEqual(historicalShift);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 42,
          date: expect.not.objectContaining({ gte: expect.anything() }),
        }),
      }),
    );
  });

  it('按班次类型查询历史排班时不设日期下界', async () => {
    const result = await service.findShiftRecord(
      42,
      null,
      EmployeeShiftType.custom,
      false,
    );

    expect(result).toEqual(historicalShift);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.not.objectContaining({ gte: expect.anything() }),
        }),
      }),
    );
  });

  it('查找后续班次时按当前班次日期收敛下界，避免全量历史扫描', async () => {
    const result = await service.findNextShiftRecord(42, historicalShift);

    expect(result).toBeNull();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it('已完成交班的历史班次不会被选为当前班次', async () => {
    attachCompletionStatus.mockResolvedValue([
      { shift: historicalShift, handedOver: true },
    ]);

    const result = await service.findCurrentShiftRecord(42, null, referenceAt);

    expect(result).toBeNull();
  });
});
