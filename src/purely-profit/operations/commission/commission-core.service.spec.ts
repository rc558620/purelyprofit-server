/**
 * 提成核心服务单测：解析规则、分配快照规范化、记录生成与状态流转。
 */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommissionCoreService } from './commission-core.service';
import { parseAssignmentsJson, parseOverridesJson } from './commission.utils';
import { makeShanghaiMs } from '../../../shared/shanghai-time.utils';

describe('CommissionCoreService', () => {
  let service: CommissionCoreService;

  const prismaService = {
    commissionService: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    commissionRecord: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  const db = prismaService as never;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionCoreService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<CommissionCoreService>(CommissionCoreService);
  });

  const buildServicesMap = async (
    services: Array<{
      id: number;
      defaultCommission: number;
      overrides?: Array<{ technicianId: number; commission: number }>;
      name?: string;
    }>,
  ) => {
    prismaService.commissionService.findMany.mockResolvedValue(
      services.map((item) => ({
        id: item.id,
        storeId: 18,
        name: item.name ?? '',
        defaultCommission: item.defaultCommission,
        enabled: true,
        sortOrder: 1,
        overrides: item.overrides ?? [],
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    return service.buildServicesMap(db as never, 18);
  };

  describe('resolveServiceCommission', () => {
    it('技师有覆盖时使用覆盖提成，否则回落默认提成', async () => {
      const map = await buildServicesMap([
        {
          id: 1,
          defaultCommission: 6000,
          overrides: [{ technicianId: 5, commission: 4500 }],
        },
        { id: 2, defaultCommission: 8000 },
      ]);

      expect(service.resolveServiceCommission(map as never, 1, 5)).toBe(4500);
      expect(service.resolveServiceCommission(map as never, 1, 6)).toBe(6000);
      expect(service.resolveServiceCommission(map as never, 2, 5)).toBe(8000);
      // 配置不存在时回落 0，避免脏数据导致金额异常
      expect(service.resolveServiceCommission(map as never, 999, 5)).toBe(0);
    });

    it('多服务一行提成为各服务覆盖/默认之和', async () => {
      const map = await buildServicesMap([
        {
          id: 1,
          defaultCommission: 6000,
          overrides: [{ technicianId: 5, commission: 4500 }],
        },
        { id: 2, defaultCommission: 8000 },
      ]);

      const money = service.resolveCommission(map as never, 5, [1, 2]);
      expect(money.toDbCents()).toBe(12500);
      expect(money.toOutputYuan()).toBe(125);
    });
  });

  describe('parseAssignmentsJson / parseOverridesJson', () => {
    it('合法 JSON 被完整解析，非法元素被丢弃', () => {
      expect(
        parseOverridesJson([
          { technicianId: 1, commission: 4500 },
          { technicianId: '5', commission: '3000' },
          { technicianId: 0, commission: 100 },
          { technicianId: 2, commission: -1 },
          null,
          'bad',
        ]),
      ).toEqual([
        { technicianId: 1, commission: 4500 },
        { technicianId: 5, commission: 3000 },
      ]);

      expect(
        parseAssignmentsJson([
          {
            technicianId: 5,
            technicianName: '王强',
            serviceIds: [1, 2],
            serviceNames: ['足疗', 'SPA'],
            commission: 4500,
          },
          {
            technicianId: 0,
            technicianName: 'x',
            serviceIds: [],
            commission: 0,
          },
          {
            technicianId: 6,
            technicianName: '李梅',
            serviceIds: [1],
            commission: -5,
          },
        ]),
      ).toEqual([
        {
          technicianId: 5,
          technicianName: '王强',
          serviceIds: [1, 2],
          serviceNames: ['足疗', 'SPA'],
          commission: 4500,
        },
      ]);
    });

    it('非数组输入返回空数组', () => {
      expect(parseOverridesJson(null)).toEqual([]);
      expect(parseAssignmentsJson(undefined)).toEqual([]);
      expect(parseOverridesJson('bad')).toEqual([]);
    });
  });

  describe('resolveTechnicianNames', () => {
    it('技师均属于门店时返回 ID → 姓名映射', async () => {
      prismaService.employee.findMany.mockResolvedValue([
        { id: 5, name: '王强' },
        { id: 6, name: '李梅' },
      ]);

      const nameById = await service.resolveTechnicianNames(
        db as never,
        18,
        [5, 6],
      );

      expect(nameById.get(5)).toBe('王强');
      expect(nameById.get(6)).toBe('李梅');
    });

    it('存在不属于门店的技师时抛出参数异常', async () => {
      prismaService.employee.findMany.mockResolvedValue([
        { id: 5, name: '王强' },
      ]);

      await expect(
        service.resolveTechnicianNames(db as never, 18, [5, 999]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaService.employee.findMany).toHaveBeenCalledWith({
        where: { id: { in: [5, 999] }, storeId: 18 },
        select: { id: true, name: true },
      });
    });
  });

  describe('normalizeAssignments', () => {
    it('手动填写金额按原值落库，缺省金额按配置解析，快照以服务端为准', async () => {
      const map = await buildServicesMap([
        { id: 1, defaultCommission: 6000, name: '足疗' },
        { id: 2, defaultCommission: 8000, name: 'SPA' },
      ]);
      const nameById = new Map([
        [5, '王强'],
        [6, '李梅'],
      ]);

      const normalized = service.normalizeAssignments(map as never, nameById, [
        {
          technicianId: 5,
          technicianName: '前端伪造姓名',
          serviceIds: [1, 2],
          serviceNames: ['前端A', '前端B'],
          commission: 120,
        },
        {
          technicianId: 6,
          technicianName: '李梅',
          serviceIds: [1],
        },
      ]);

      expect(normalized).toEqual([
        {
          technicianId: 5,
          technicianName: '王强',
          serviceIds: [1, 2],
          serviceNames: ['足疗', 'SPA'],
          commission: 12000,
        },
        {
          technicianId: 6,
          technicianName: '李梅',
          serviceIds: [1],
          serviceNames: ['足疗'],
          commission: 6000,
        },
      ]);
    });
  });

  describe('recomputeAssignments', () => {
    it('结账时按配置重算每行金额，忽略开台快照金额，并生成每服务拆分金额', async () => {
      const map = await buildServicesMap([
        {
          id: 1,
          defaultCommission: 6000,
          overrides: [{ technicianId: 5, commission: 4500 }],
          name: '足疗',
        },
        { id: 2, defaultCommission: 8000, name: 'SPA' },
      ]);

      const final = service.recomputeAssignments(map as never, [
        {
          technicianId: 5,
          technicianName: '王强',
          serviceIds: [1, 2],
          serviceNames: ['足疗', 'SPA'],
          commission: 99999,
        },
      ]);

      expect(final[0]?.commission).toBe(12500);
      // 拆分金额与总额同源（覆盖/默认），合计等于总额
      expect(final[0]?.serviceCommissions).toEqual([4500, 8000]);
      expect(
        (final[0]?.serviceCommissions ?? []).reduce(
          (sum, value) => sum + value,
          0,
        ),
      ).toBe(final[0]?.commission ?? 0);
    });
  });

  describe('createSettledRecords', () => {
    it('批量生成 settled 提成记录，归属月份按结账时间上海时区', async () => {
      prismaService.commissionRecord.createMany.mockResolvedValue({ count: 2 });

      const settledAt = new Date(makeShanghaiMs(2026, 6, 15));
      await service.createSettledRecords(db as never, {
        storeId: 18,
        sessionId: 9,
        spaceName: 'A01',
        assignments: [
          {
            technicianId: 5,
            technicianName: '王强',
            serviceIds: [1],
            serviceNames: ['足疗'],
            serviceCommissions: [4500],
            commission: 4500,
          },
          {
            technicianId: 6,
            technicianName: '李梅',
            serviceIds: [1, 2],
            serviceNames: ['足疗', 'SPA'],
            serviceCommissions: [6000, 6500],
            commission: 12500,
          },
        ],
        settledAt,
        month: '2026-07',
      });

      expect(prismaService.commissionRecord.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            storeId: 18,
            sessionId: 9,
            spaceName: 'A01',
            technicianId: 5,
            technicianName: '王强',
            serviceCommissions: [4500],
            commission: 4500,
            status: 'settled',
            month: '2026-07',
            settledAt,
          }),
          expect.objectContaining({
            technicianId: 6,
            technicianName: '李梅',
            serviceCommissions: [6000, 6500],
            commission: 12500,
          }),
        ],
      });
    });

    it('无提成分配时不写入任何记录', async () => {
      await service.createSettledRecords(db as never, {
        storeId: 18,
        sessionId: 9,
        spaceName: 'A01',
        assignments: [],
        settledAt: new Date(),
        month: '2026-07',
      });

      expect(prismaService.commissionRecord.createMany).not.toHaveBeenCalled();
    });
  });

  describe('markSettledRecordsIncluded', () => {
    it('将员工当月 settled 记录标记为 included 并返回影响行数', async () => {
      prismaService.commissionRecord.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.markSettledRecordsIncluded(
        db as never,
        18,
        5,
        '2026-07',
      );

      expect(count).toBe(3);
      expect(prismaService.commissionRecord.updateMany).toHaveBeenCalledWith({
        where: {
          storeId: 18,
          technicianId: 5,
          month: '2026-07',
          status: 'settled',
        },
        data: { status: 'included' },
      });
    });
  });
});
