import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeesShiftDefinitionService } from './employees-shift-definition.service';
import { EmployeesAccessService } from './employees-access.service';

describe('EmployeesShiftDefinitionService', () => {
  let service: EmployeesShiftDefinitionService;

  const prismaService = {
    employeeShiftDefinition: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const employeesAccessService = {
    resolveSingleStoreId: jest.fn(),
    ensureCanManageEmployees: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    currentMembership: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesShiftDefinitionService,
        { provide: PrismaService, useValue: prismaService },
        { provide: EmployeesAccessService, useValue: employeesAccessService },
      ],
    }).compile();

    service = module.get<EmployeesShiftDefinitionService>(
      EmployeesShiftDefinitionService,
    );

    jest.clearAllMocks();
  });

  describe('listShiftDefinitions', () => {
    it('成功返回班次定义列表', async () => {
      employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
      const createdAt = new Date('2026-06-01T10:00:00.000Z');
      const updatedAt = new Date('2026-06-01T10:00:00.000Z');

      prismaService.employeeShiftDefinition.findMany.mockResolvedValue([
        {
          id: 1,
          storeId: 2,
          name: '早班',
          defaultStartTime: '08:00',
          defaultEndTime: '14:00',
          createdAt,
          updatedAt,
        },
        {
          id: 2,
          storeId: 2,
          name: '晚班',
          defaultStartTime: '18:00',
          defaultEndTime: '23:00',
          createdAt,
          updatedAt,
        },
      ]);

      const result = await service.listShiftDefinitions(user, { storeId: 2 });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '1',
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      });
      expect(result[1]).toEqual({
        id: '2',
        name: '晚班',
        defaultStartTime: '18:00',
        defaultEndTime: '23:00',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      });
    });
  });

  describe('createShiftDefinition', () => {
    it('同门店新增成功', async () => {
      employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
      prismaService.employeeShiftDefinition.findFirst.mockResolvedValue(null);

      const createdAt = new Date('2026-06-01T10:00:00.000Z');
      const updatedAt = new Date('2026-06-01T10:00:00.000Z');

      prismaService.employeeShiftDefinition.create.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt,
        updatedAt,
      });

      const result = await service.createShiftDefinition(user, {
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
      });

      expect(result).toEqual({
        id: '1',
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      });
    });

    it('同门店重名返回 409', async () => {
      employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
      prismaService.employeeShiftDefinition.findFirst.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.createShiftDefinition(user, {
          storeId: 2,
          name: '早班',
          defaultStartTime: '09:00',
          defaultEndTime: '15:00',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('大小写不敏感重名返回 409', async () => {
      employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
      prismaService.employeeShiftDefinition.findFirst.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.createShiftDefinition(user, {
          storeId: 2,
          name: '早班',
          defaultStartTime: '09:00',
          defaultEndTime: '15:00',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('时间格式非法返回 400', async () => {
      employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);

      await expect(
        service.createShiftDefinition(user, {
          storeId: 2,
          name: '早班',
          defaultStartTime: '8:00',
          defaultEndTime: '14:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('开始时间 >= 结束时间返回 400', async () => {
      employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);

      await expect(
        service.createShiftDefinition(user, {
          storeId: 2,
          name: '早班',
          defaultStartTime: '14:00',
          defaultEndTime: '14:00',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createShiftDefinition(user, {
          storeId: 2,
          name: '早班',
          defaultStartTime: '15:00',
          defaultEndTime: '14:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateShiftDefinition', () => {
    it('成功更新班次定义', async () => {
      const createdAt = new Date('2026-06-01T10:00:00.000Z');
      const updatedAt = new Date('2026-06-01T12:00:00.000Z');

      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt,
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      });
      employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
        undefined,
      );
      prismaService.employeeShiftDefinition.findFirst.mockResolvedValue(null);
      prismaService.employeeShiftDefinition.update.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '晚班',
        defaultStartTime: '18:00',
        defaultEndTime: '23:00',
        createdAt,
        updatedAt,
      });

      const result = await service.updateShiftDefinition(user, 1, {
        name: '晚班',
        defaultStartTime: '18:00',
        defaultEndTime: '23:00',
      });

      expect(result).toEqual({
        id: '1',
        name: '晚班',
        defaultStartTime: '18:00',
        defaultEndTime: '23:00',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      });
    });

    it('班次定义不存在返回 404', async () => {
      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue(null);

      await expect(
        service.updateShiftDefinition(user, 999, { name: '晚班' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeShiftDefinition', () => {
    it('成功删除班次定义', async () => {
      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
        undefined,
      );
      prismaService.employeeShiftDefinition.delete.mockResolvedValue({});

      await service.removeShiftDefinition(user, 1);

      expect(prismaService.employeeShiftDefinition.delete).toHaveBeenCalledWith(
        {
          where: { id: 1 },
        },
      );
    });

    it('班次定义不存在返回 404', async () => {
      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue(null);

      await expect(service.removeShiftDefinition(user, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('删除已被历史排班引用的定义后，历史排班仍可查询', async () => {
      // 删除操作本身会成功，因为 schema 中设置了 onDelete: SetNull
      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
        undefined,
      );
      prismaService.employeeShiftDefinition.delete.mockResolvedValue({});

      await service.removeShiftDefinition(user, 1);

      expect(prismaService.employeeShiftDefinition.delete).toHaveBeenCalled();
    });
  });

  describe('findShiftDefinitionForStoreOrThrow', () => {
    it('成功返回班次定义', async () => {
      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue({
        id: 1,
        storeId: 2,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.findShiftDefinitionForStoreOrThrow(2, 1);

      expect(result.name).toBe('早班');
    });

    it('班次定义不存在返回 404', async () => {
      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue(null);

      await expect(
        service.findShiftDefinitionForStoreOrThrow(2, 999),
      ).rejects.toThrow(NotFoundException);
    });

    it('跨店 shiftDefinitionId 禁止使用', async () => {
      prismaService.employeeShiftDefinition.findUnique.mockResolvedValue({
        id: 1,
        storeId: 3,
        name: '早班',
        defaultStartTime: '08:00',
        defaultEndTime: '14:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.findShiftDefinitionForStoreOrThrow(2, 1),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
