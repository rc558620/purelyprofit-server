import { EmployeeShiftType } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { HandoverConfirmShiftService } from './handover-confirm-shift.service';

/**
 * 验证 pickShiftRecord 的 active-shift 窗口在 BUG-2 修复后（handoverAt 恒 > endAt）
 * 仍能正确选中刚结束的班次。HANDOVER_SHIFT_GRACE_HOURS = 4 宽限窗口是关键。
 */
describe('HandoverConfirmShiftService', () => {
  let service: HandoverConfirmShiftService;

  const prismaService = {
    employeeShift: {
      findMany: jest.fn(),
    },
    storeHandoverRecord: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const storeSubAccountService = {
    findAssignedSubAccountByEmployee: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverConfirmShiftService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: StoreSubAccountService,
          useValue: storeSubAccountService,
        },
      ],
    }).compile();

    service = module.get<HandoverConfirmShiftService>(
      HandoverConfirmShiftService,
    );
  });

  const shiftB = {
    id: 12,
    employeeId: 20,
    employeeName: '员工B',
    shiftType: EmployeeShiftType.morning,
    shiftName: '早班',
    date: new Date(2026, 4, 13),
    startTime: '08:00',
    endTime: '12:00',
    createdAt: new Date(2026, 4, 13, 7, 0, 0),
  };
  const shiftA = {
    id: 11,
    employeeId: 20,
    employeeName: '员工A',
    shiftType: EmployeeShiftType.morning,
    shiftName: '早班',
    date: new Date(2026, 4, 13),
    startTime: '13:00',
    endTime: '17:00',
    createdAt: new Date(2026, 4, 13, 8, 0, 0),
  };

  it('交班晚于班次结束但仍在宽限窗口内时，应选中刚结束的班次（active 逻辑生效）', async () => {
    // 同日同类型两个班次，按 startTime 升序：B(08-12) 早于 A(13-17)
    prismaService.employeeShift.findMany.mockResolvedValue([shiftB, shiftA]);
    const handoverAt = new Date(2026, 4, 13, 17, 30, 0); // A 结束后 30 分钟，落在 4h 宽限内

    const result = await service.findSourceShiftRecord(100, 20, {
      shiftType: EmployeeShiftType.morning,
      handoverAt,
    });

    // 若为死代码（无宽限），active 为空会回退到 matchedByType[0]=B；
    // 宽限生效时应选中刚结束的 A。
    expect(result?.id).toBe(shiftA.id);
  });

  it('交班远超宽限窗口后回退到按类型匹配（选中最早同类型班次）', async () => {
    prismaService.employeeShift.findMany.mockResolvedValue([shiftB, shiftA]);
    const handoverAt = new Date(2026, 4, 13, 22, 0, 0); // A 结束后 5h，超出 4h 宽限

    const result = await service.findSourceShiftRecord(100, 20, {
      shiftType: EmployeeShiftType.morning,
      handoverAt,
    });

    expect(result?.id).toBe(shiftB.id);
  });

  it('交班在班次进行中仍能选中该班次（宽限不影响进行中）', async () => {
    prismaService.employeeShift.findMany.mockResolvedValue([shiftA]);
    const handoverAt = new Date(2026, 4, 13, 15, 0, 0); // A 进行中

    const result = await service.findSourceShiftRecord(100, 20, {
      shiftType: EmployeeShiftType.morning,
      handoverAt,
    });

    expect(result?.id).toBe(shiftA.id);
  });

  it('F2: ensureShiftNotHandedOver owner 分支应使用 shiftRecord.date 而非 handoverAt 作为基准', async () => {
    // 老板账号交班、班次 employeeId 为空、跨夜班次
    const crossNightShift = {
      id: 50,
      employeeId: null,
      employeeName: '夜班员工',
      shiftType: EmployeeShiftType.late,
      shiftName: '夜班',
      date: new Date(2026, 6, 11), // 7月11日
      startTime: '20:00',
      endTime: '02:00',
      createdAt: new Date(2026, 6, 11, 19, 0, 0),
    };
    const handoverAt = new Date(2026, 6, 12, 2, 30, 0); // 7月12日 02:30
    prismaService.storeHandoverRecord.count.mockResolvedValue(0);

    await service.ensureShiftNotHandedOver(
      prismaService as any,
      100,
      crossNightShift as any,
      handoverAt,
    );

    // 验证查询用的是 shiftRecord.date(7/11) 计算的班次窗口 [7/11 20:00, 7/12 02:00]
    // 而非 handoverAt(7/12) 计算的错位窗口 [7/12 20:00, 7/13 02:00]
    const callArgs = prismaService.storeHandoverRecord.count.mock.calls[0][0];
    const timeRange = callArgs.where.handoverAt;
    // startAt 应是 7/11 20:00 而非 7/12 20:00
    expect(timeRange.gte.getHours()).toBe(20);
    expect(timeRange.gte.getDate()).toBe(11);
    // endAt 应是 7/12 02:00 而非 7/13 02:00
    expect(timeRange.lte.getHours()).toBe(2);
    expect(timeRange.lte.getDate()).toBe(12);
  });

  it('F4: 未传 shiftReferenceAt 且当天未找到班次时，应向前回溯一天查找', async () => {
    const yesterdayShift = {
      id: 99,
      employeeId: 20,
      employeeName: '员工X',
      shiftType: EmployeeShiftType.late,
      shiftName: '晚班',
      date: new Date(2026, 6, 11),
      startTime: '20:00',
      endTime: '02:00',
      createdAt: new Date(2026, 6, 11, 19, 0, 0),
    };
    // loadShiftCandidates 被调用两次（先查指定员工，再查全店） + 扩展范围一次
    prismaService.employeeShift.findMany
      .mockResolvedValueOnce([]) // 第一次：指定员工当天无班次
      .mockResolvedValueOnce([]) // 第二次：全店当天无班次
      .mockResolvedValueOnce([yesterdayShift]); // 第三次：扩展范围
    // pickEarliestUnhandedShift 查询已完成交班记录 → 返回空（该班次未交班）
    prismaService.storeHandoverRecord.findMany.mockResolvedValue([]);

    const handoverAt = new Date(2026, 6, 12, 2, 30, 0);
    const result = await service.findSourceShiftRecord(100, 20, {
      shiftType: EmployeeShiftType.late,
      handoverAt,
      // 注意：不传 shiftReferenceAt
    });

    expect(result?.id).toBe(yesterdayShift.id);
    expect(prismaService.employeeShift.findMany).toHaveBeenCalledTimes(3);
    // 确认 pickEarliestUnhandedShift 检查了交班完成记录
    expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledTimes(1);
  });
});
