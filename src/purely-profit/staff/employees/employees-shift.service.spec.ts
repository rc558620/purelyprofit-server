import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeesShiftService } from './employees-shift.service';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesShiftDefinitionService } from './employees-shift-definition.service';

describe('EmployeesShiftService', () => {
  let service: EmployeesShiftService;

  const prismaService = {
    employeeShift: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const employeesAccessService = {
    resolveViewStoreId: jest.fn(),
    ensureCanManageEmployees: jest.fn(),
    findManageableEmployeeOrThrow: jest.fn(),
  };

  const employeesShiftDefinitionService = {
    findShiftDefinitionForStoreOrThrow: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: null,
  };

  const createdAt = new Date('2026-06-01T10:00:00.000Z');
  const updatedAt = new Date('2026-06-01T10:00:00.000Z');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesShiftService,
        { provide: PrismaService, useValue: prismaService },
        { provide: EmployeesAccessService, useValue: employeesAccessService },
        {
          provide: EmployeesShiftDefinitionService,
          useValue: employeesShiftDefinitionService,
        },
      ],
    }).compile();

    service = module.get<EmployeesShiftService>(EmployeesShiftService);

    jest.clearAllMocks();
  });

  describe('createShift', () => {
    it('使用有效 shiftDefinitionId 创建成功', async () => {
      employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
        id: 5,
        storeId: 2,
        name: '张三',
      });
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
        {
          id: 1,
          name: '早班',
          defaultStartTime: '08:00',
          defaultEndTime: '14:00',
        },
      );
      prismaService.employeeShift.findMany.mockResolvedValue([]);
      prismaService.employeeShift.create.mockResolvedValue({
        id: 10,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: null,
        shiftDefinitionId: 1,
        shiftName: '早班',
        date: new Date('2026-06-01'),
        startTime: '08:00',
        endTime: '14:00',
        note: null,
        createdAt,
        updatedAt,
      });

      const result = await service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-06-01').getTime(),
        shiftDefinitionId: 1,
      });

      expect(result).toMatchObject({
        id: '10',
        employeeId: '5',
        employeeName: '张三',
        date: new Date('2026-06-01').getTime(),
        shiftDefinitionId: '1',
        shiftName: '早班',
        startTime: '08:00',
        endTime: '14:00',
        createdAt: createdAt.getTime(),
      });
    });

    it('shiftDefinitionId 不存在返回明确异常', async () => {
      employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
        id: 5,
        storeId: 2,
        name: '张三',
      });
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockRejectedValue(
        new NotFoundException('班次定义不存在'),
      );

      await expect(
        service.createShift(user, {
          employeeId: 5,
          date: new Date('2026-06-01').getTime(),
          shiftDefinitionId: 999,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('跨店 shiftDefinitionId 禁止使用', async () => {
      employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
        id: 5,
        storeId: 2,
        name: '张三',
      });
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockRejectedValue(
        new ForbiddenException('不能使用其他门店的班次定义'),
      );

      await expect(
        service.createShift(user, {
          employeeId: 5,
          date: new Date('2026-06-01').getTime(),
          shiftDefinitionId: 1,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('同员工同日时间重叠返回 409', async () => {
      employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
        id: 5,
        storeId: 2,
        name: '张三',
      });
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
        {
          id: 1,
          name: '早班',
          defaultStartTime: '08:00',
          defaultEndTime: '14:00',
        },
      );
      prismaService.employeeShift.findMany.mockResolvedValue([
        {
          id: 9,
          startTime: '09:00',
          endTime: '15:00',
        },
      ]);

      await expect(
        service.createShift(user, {
          employeeId: 5,
          date: new Date('2026-06-01').getTime(),
          shiftDefinitionId: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('返回结构带 shiftName', async () => {
      employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
        id: 5,
        storeId: 2,
        name: '张三',
      });
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
        {
          id: 1,
          name: '早班',
          defaultStartTime: '08:00',
          defaultEndTime: '14:00',
        },
      );
      prismaService.employeeShift.findMany.mockResolvedValue([]);
      prismaService.employeeShift.create.mockResolvedValue({
        id: 10,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: null,
        shiftDefinitionId: 1,
        shiftName: '早班',
        date: new Date('2026-06-01'),
        startTime: '08:00',
        endTime: '14:00',
        note: null,
        createdAt,
        updatedAt,
      });

      const result = await service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-06-01').getTime(),
        shiftDefinitionId: 1,
      });

      expect(result.shiftName).toBe('早班');
      expect(prismaService.employeeShift.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shiftType: 'morning',
        }),
      });
    });

    it('自定义班次会回填 custom 类型以兼容旧库约束', async () => {
      employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
        id: 5,
        storeId: 2,
        name: '张三',
      });
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
        {
          id: 3,
          name: '小点点滴滴（收尾）',
          defaultStartTime: '10:30',
          defaultEndTime: '16:30',
        },
      );
      prismaService.employeeShift.findMany.mockResolvedValue([]);
      prismaService.employeeShift.create.mockResolvedValue({
        id: 11,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: 'custom',
        shiftDefinitionId: 3,
        shiftName: '小点点滴滴（收尾）',
        date: new Date('2026-06-02'),
        startTime: '10:30',
        endTime: '16:30',
        note: null,
        createdAt,
        updatedAt,
      });

      await service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-06-02').getTime(),
        shiftDefinitionId: 3,
      });

      expect(prismaService.employeeShift.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shiftType: 'custom',
        }),
      });
    });

    it('沿用早班名称但修改时间后应视为 custom 类型', async () => {
      employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
        id: 5,
        storeId: 2,
        name: '张三',
      });
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
        {
          id: 4,
          name: '早班',
          defaultStartTime: '16:01',
          defaultEndTime: '17:03',
        },
      );
      prismaService.employeeShift.findMany.mockResolvedValue([]);
      prismaService.employeeShift.create.mockResolvedValue({
        id: 12,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: 'custom',
        shiftDefinitionId: 4,
        shiftName: '早班',
        date: new Date('2026-06-05'),
        startTime: '16:01',
        endTime: '17:03',
        note: null,
        createdAt,
        updatedAt,
      });

      await service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-06-05').getTime(),
        shiftDefinitionId: 4,
      });

      expect(prismaService.employeeShift.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shiftType: 'custom',
          shiftName: '早班',
          startTime: '16:01',
          endTime: '17:03',
        }),
      });
    });
  });

  describe('listShifts', () => {
    it('历史数据 shiftDefinitionId = null 时仍能正常返回 shiftName', async () => {
      employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
      prismaService.employeeShift.findMany.mockResolvedValue([
        {
          id: 8,
          storeId: 2,
          employeeId: 5,
          employeeName: '张三',
          shiftType: 'morning',
          shiftDefinitionId: null,
          shiftName: '早班',
          date: new Date('2026-05-15'),
          startTime: '08:00',
          endTime: '14:00',
          note: null,
          createdAt,
          updatedAt,
        },
      ]);

      const result = await service.listShifts(user, { storeId: 2 });

      expect(result).toHaveLength(1);
      expect(result[0].shiftDefinitionId).toBeUndefined();
      expect(result[0].shiftName).toBe('早班');
    });
  });

  describe('updateShift', () => {
    it('成功更新排班记录', async () => {
      prismaService.employeeShift.findUnique.mockResolvedValue({
        id: 10,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: 'morning',
        shiftDefinitionId: 1,
        shiftName: '早班',
        date: new Date('2026-06-01'),
        startTime: '08:00',
        endTime: '14:00',
        note: null,
        createdAt,
        updatedAt,
      });
      employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
        undefined,
      );
      prismaService.employeeShift.findMany.mockResolvedValue([]);
      employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
        {
          id: 2,
          name: '晚班',
          defaultStartTime: '18:00',
          defaultEndTime: '23:00',
        },
      );
      prismaService.employeeShift.update.mockResolvedValue({
        id: 10,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: null,
        shiftDefinitionId: 2,
        shiftName: '晚班',
        date: new Date('2026-06-01'),
        startTime: '18:00',
        endTime: '23:00',
        note: '更新备注',
        createdAt,
        updatedAt,
      });

      const result = await service.updateShift(user, 10, {
        shiftDefinitionId: 2,
        note: '更新备注',
      });

      expect(result.shiftDefinitionId).toBe('2');
      expect(result.shiftName).toBe('晚班');
      expect(prismaService.employeeShift.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: expect.objectContaining({
          shiftType: 'custom',
          shiftDefinitionId: 2,
        }),
      });
    });
  });

  describe('removeShift', () => {
    it('成功删除排班记录', async () => {
      prismaService.employeeShift.findUnique.mockResolvedValue({
        id: 10,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: 'morning',
        shiftDefinitionId: 1,
        shiftName: '早班',
        date: new Date('2026-06-01'),
        startTime: '08:00',
        endTime: '14:00',
        note: null,
        createdAt,
        updatedAt,
      });
      employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
        undefined,
      );
      prismaService.employeeShift.delete.mockResolvedValue({});

      await service.removeShift(user, 10);

      expect(prismaService.employeeShift.delete).toHaveBeenCalledWith({
        where: { id: 10 },
      });
    });

    it('旧版 shiftType 为null 時也可正常删除', async () => {
      prismaService.employeeShift.findUnique.mockResolvedValue({
        id: 10,
        storeId: 2,
        employeeId: 5,
        employeeName: '张三',
        shiftType: null,
        shiftDefinitionId: null,
        shiftName: '自定义',
        date: new Date('2026-06-01'),
        startTime: '08:00',
        endTime: '14:00',
        note: null,
        createdAt,
        updatedAt,
      });
      employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
        undefined,
      );
      prismaService.employeeShift.delete.mockResolvedValue({});

      await service.removeShift(user, 10);

      expect(prismaService.employeeShift.delete).toHaveBeenCalledWith({
        where: { id: 10 },
      });
    });

    it('排班记录不存在返回 404', async () => {
      prismaService.employeeShift.findUnique.mockResolvedValue(null);

      await expect(service.removeShift(user, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
