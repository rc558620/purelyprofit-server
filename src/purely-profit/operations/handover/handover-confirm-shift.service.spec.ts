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
});
