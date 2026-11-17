import { HandoverStatus } from '@prisma/client';
import { HandoverShiftHandoverStatusService } from './handover-shift-handover-status.service';
import { buildShiftDateRange, type ShiftRecordRow } from './handover.shared';

type HandoverRecordFixture = {
  employeeShiftIdSnapshot: number | null;
  fromEmployeeId: number | null;
  handoverAt: Date | null;
  createdAt: Date;
};

const SHIFT_DATE = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));

const buildShift = (
  overrides: Partial<ShiftRecordRow> = {},
): ShiftRecordRow => ({
  id: 101,
  employeeId: 7,
  employeeName: '张三',
  shiftType: 'morning',
  shiftName: '早班',
  date: SHIFT_DATE,
  startTime: '08:00',
  endTime: '14:00',
  createdAt: SHIFT_DATE,
  ...overrides,
});

const buildService = (records: HandoverRecordFixture[]) => {
  const findMany = jest.fn().mockResolvedValue(records);
  const count = jest.fn().mockResolvedValue(0);
  const service = new HandoverShiftHandoverStatusService({
    storeHandoverRecord: { findMany, count },
  } as unknown as ConstructorParameters<
    typeof HandoverShiftHandoverStatusService
  >[0]);
  return { service, findMany, count };
};

/** 班次结束时刻（同店兜底匹配窗口的基准点） */
const shiftEndAt = (shift: ShiftRecordRow): Date =>
  buildShiftDateRange(shift.startTime, shift.endTime, shift.date).endAt;

describe('HandoverShiftHandoverStatusService - 批量交班状态匹配', () => {
  it('空班次列表直接返回空数组，不发起查询', async () => {
    const { service, findMany } = buildService([]);

    await expect(service.attachCompletionStatus(1, [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('employeeShiftIdSnapshot 精确匹配时应判定为已交班', async () => {
    const shift = buildShift();
    const { service, findMany } = buildService([
      {
        employeeShiftIdSnapshot: shift.id ?? 0,
        fromEmployeeId: shift.employeeId ?? null,
        handoverAt: shiftEndAt(shift),
        createdAt: SHIFT_DATE,
      },
    ]);

    const [result] = await service.attachCompletionStatus(1, [shift]);

    expect(result.handedOver).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('无快照但 handoverAt 落在班次结束宽限期内时应判定为已交班', async () => {
    const shift = buildShift();
    const handoverAt = new Date(shiftEndAt(shift).getTime() + 30 * 60_000);
    const { service } = buildService([
      {
        employeeShiftIdSnapshot: null,
        fromEmployeeId: shift.employeeId ?? null,
        handoverAt,
        createdAt: handoverAt,
      },
    ]);

    const [result] = await service.attachCompletionStatus(1, [shift]);

    expect(result.handedOver).toBe(true);
  });

  it('无快照且 handoverAt 超出宽限期时应判定为未交班', async () => {
    const shift = buildShift();
    const handoverAt = new Date(shiftEndAt(shift).getTime() + 5 * 3_600_000);
    const { service } = buildService([
      {
        employeeShiftIdSnapshot: null,
        fromEmployeeId: shift.employeeId ?? null,
        handoverAt,
        createdAt: handoverAt,
      },
    ]);

    const [result] = await service.attachCompletionStatus(1, [shift]);

    expect(result.handedOver).toBe(false);
  });

  it('无快照且 handoverAt 早于班次开始时应判定为未交班', async () => {
    const shift = buildShift();
    const shiftRange = buildShiftDateRange(
      shift.startTime,
      shift.endTime,
      shift.date,
    );
    const handoverAt = new Date(shiftRange.startAt.getTime() - 60_000);
    const { service } = buildService([
      {
        employeeShiftIdSnapshot: null,
        fromEmployeeId: shift.employeeId ?? null,
        handoverAt,
        createdAt: handoverAt,
      },
    ]);

    const [result] = await service.attachCompletionStatus(1, [shift]);

    expect(result.handedOver).toBe(false);
  });

  it('兜底记录创建时间早于班次创建时间时不计入交班', async () => {
    const shift = buildShift({
      createdAt: new Date(SHIFT_DATE.getTime() + 3_600_000),
    });
    const handoverAt = new Date(shiftEndAt(shift).getTime() + 30 * 60_000);
    const { service } = buildService([
      {
        employeeShiftIdSnapshot: null,
        fromEmployeeId: shift.employeeId ?? null,
        handoverAt,
        createdAt: new Date(SHIFT_DATE.getTime() - 3_600_000),
      },
    ]);

    const [result] = await service.attachCompletionStatus(1, [shift]);

    expect(result.handedOver).toBe(false);
  });

  it('兜底记录按 fromEmployeeId 分桶，不应串到其他员工的班次', async () => {
    const shift = buildShift({ employeeId: 7 });
    const otherShift = buildShift({
      id: 202,
      employeeId: 8,
      employeeName: '李四',
    });
    const handoverAt = new Date(shiftEndAt(otherShift).getTime() + 30 * 60_000);
    const { service } = buildService([
      {
        employeeShiftIdSnapshot: null,
        fromEmployeeId: 8,
        handoverAt,
        createdAt: handoverAt,
      },
    ]);

    const results = await service.attachCompletionStatus(1, [
      shift,
      otherShift,
    ]);

    expect(results[0].handedOver).toBe(false);
    expect(results[1].handedOver).toBe(true);
  });
});

describe('HandoverShiftHandoverStatusService - 请求级 memo', () => {
  it('同一班次重复查询时只发起一次 count', async () => {
    const shift = buildShift();
    const { service, count } = buildService([]);
    const memo = new Map<number, boolean>();

    const first = await service.isShiftHandedOver(1, shift, memo);
    const second = await service.isShiftHandedOver(1, shift, memo);

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 1,
          fromEmployeeId: shift.employeeId,
          status: HandoverStatus.completed,
        }),
      }),
    );
  });

  it('没有员工 ID 的班次不发起查询', async () => {
    const { service, count } = buildService([]);

    await expect(
      service.isShiftHandedOver(1, buildShift({ employeeId: null })),
    ).resolves.toBe(false);
    expect(count).not.toHaveBeenCalled();
  });
});
