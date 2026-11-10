import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type EmployeeDepartment,
  type EmployeePosition,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateEmployeeDictionaryDto,
  EmployeeDepartmentResponseDto,
  EmployeePositionResponseDto,
  EmployeeStoreQueryDto,
  UpdateEmployeeDictionaryDto,
} from './dto/employee-dictionary.dto';
import { EmployeesAccessService } from './employees-access.service';
import {
  toEmployeeDepartmentResponse,
  toEmployeePositionResponse,
} from './employees.mapper';

@Injectable()
export class EmployeesDictionaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
  ) {}

  async listDepartments(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeeDepartmentResponseDto[]> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'staff:view',
    );
    const rows = await this.findDepartmentRows(storeId);
    if (rows.length === 0) {
      // 首次访问才补建默认部门：用列表结果判断，省掉每次列表的 count 查询
      await this.ensureDepartment(storeId, '综合部');
      return (await this.findDepartmentRows(storeId)).map(
        toEmployeeDepartmentResponse,
      );
    }
    return rows.map(toEmployeeDepartmentResponse);
  }

  async createDepartment(
    user: AuthenticatedUser,
    dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'staff:create',
    );
    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable('department', storeId, name);
    const department = await this.prisma.employeeDepartment.create({
      data: {
        storeId,
        name,
      },
    });
    return toEmployeeDepartmentResponse(department);
  }

  async updateDepartment(
    user: AuthenticatedUser,
    departmentId: number,
    dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    const existing = await this.prisma.employeeDepartment.findUnique({
      where: { id: departmentId },
    });
    if (!existing) {
      throw new NotFoundException('部门不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );

    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable(
      'department',
      existing.storeId,
      name,
      existing.id,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.employeeDepartment.update({
        where: { id: existing.id },
        data: { name },
      });
      await tx.employee.updateMany({
        where: { departmentId: existing.id },
        data: { department: next.name },
      });
      return next;
    });
    return toEmployeeDepartmentResponse(updated);
  }

  async removeDepartment(
    user: AuthenticatedUser,
    departmentId: number,
  ): Promise<void> {
    const existing = await this.prisma.employeeDepartment.findUnique({
      where: { id: departmentId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) {
      throw new NotFoundException('部门不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );
    if (existing._count.employees > 0) {
      throw new ConflictException('当前部门下仍有关联员工，无法删除');
    }
    await this.prisma.employeeDepartment.delete({ where: { id: existing.id } });
  }

  async listPositions(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeePositionResponseDto[]> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'staff:view',
    );
    const rows = await this.findPositionRows(storeId);
    if (rows.length === 0) {
      // 首次访问才补建默认职位：用列表结果判断，省掉每次列表的 count 查询
      await this.ensurePosition(storeId, '默认职位');
      return (await this.findPositionRows(storeId)).map(
        toEmployeePositionResponse,
      );
    }
    return rows.map(toEmployeePositionResponse);
  }

  async createPosition(
    user: AuthenticatedUser,
    dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'staff:create',
    );
    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable('position', storeId, name);
    const position = await this.prisma.employeePosition.create({
      data: {
        storeId,
        name,
      },
    });
    return toEmployeePositionResponse(position);
  }

  async updatePosition(
    user: AuthenticatedUser,
    positionId: number,
    dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    const existing = await this.prisma.employeePosition.findUnique({
      where: { id: positionId },
    });
    if (!existing) {
      throw new NotFoundException('职位不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );

    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable(
      'position',
      existing.storeId,
      name,
      existing.id,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.employeePosition.update({
        where: { id: existing.id },
        data: { name },
      });
      await tx.employee.updateMany({
        where: { positionId: existing.id },
        data: { position: next.name },
      });
      return next;
    });
    return toEmployeePositionResponse(updated);
  }

  async removePosition(
    user: AuthenticatedUser,
    positionId: number,
  ): Promise<void> {
    const existing = await this.prisma.employeePosition.findUnique({
      where: { id: positionId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) {
      throw new NotFoundException('职位不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );
    if (existing._count.employees > 0) {
      throw new ConflictException('当前职位下仍有关联员工，无法删除');
    }
    await this.prisma.employeePosition.delete({ where: { id: existing.id } });
  }

  ensureDepartment(storeId: number, name: string) {
    return this.ensureDictionaryRecord('department', storeId, name);
  }

  ensurePosition(storeId: number, name: string) {
    return this.ensureDictionaryRecord('position', storeId, name);
  }

  private findDepartmentRows(storeId: number): Promise<EmployeeDepartment[]> {
    return this.prisma.employeeDepartment.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private findPositionRows(storeId: number): Promise<EmployeePosition[]> {
    return this.prisma.employeePosition.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async ensureDictionaryNameAvailable(
    type: 'department' | 'position',
    storeId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const normalizedName = name.trim();
    const where = {
      storeId,
      name: { equals: normalizedName, mode: 'insensitive' as const },
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    };

    const existing =
      type === 'department'
        ? await this.prisma.employeeDepartment.findFirst({ where })
        : await this.prisma.employeePosition.findFirst({ where });

    if (existing) {
      throw new ConflictException(
        type === 'department'
          ? '已存在同名部门，请换个名称'
          : '已存在同名职位，请换个名称',
      );
    }
  }

  private async ensureDictionaryRecord(
    type: 'department' | 'position',
    storeId: number,
    name: string,
  ) {
    const normalizedName = name.trim();

    if (type === 'department') {
      const existing = await this.prisma.employeeDepartment.findFirst({
        where: {
          storeId,
          name: { equals: normalizedName, mode: 'insensitive' },
        },
      });
      if (existing) {
        return existing;
      }

      // #20 修复：使用 upsert 模式避免并发创建同名记录时的唯一约束冲突
      try {
        return await this.prisma.employeeDepartment.create({
          data: { storeId, name: normalizedName },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return await this.prisma.employeeDepartment.findFirstOrThrow({
            where: {
              storeId,
              name: { equals: normalizedName, mode: 'insensitive' },
            },
          });
        }
        throw error;
      }
    }

    const existing = await this.prisma.employeePosition.findFirst({
      where: {
        storeId,
        name: { equals: normalizedName, mode: 'insensitive' },
      },
    });
    if (existing) {
      return existing;
    }

    // #20 修复：使用 upsert 模式避免并发创建同名记录时的唯一约束冲突
    try {
      return await this.prisma.employeePosition.create({
        data: { storeId, name: normalizedName },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return await this.prisma.employeePosition.findFirstOrThrow({
          where: {
            storeId,
            name: { equals: normalizedName, mode: 'insensitive' },
          },
        });
      }
      throw error;
    }
  }
}
