import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  CreateEmployeeShiftDefinitionDto,
  EmployeeShiftDefinitionResponseDto,
  UpdateEmployeeShiftDefinitionDto,
} from './dto/employee-shift-definition.dto';
import { EmployeeStoreQueryDto } from './dto/employee-dictionary.dto';
import { parseTimeToMinutes } from './employees.domain';
import { toEmployeeShiftDefinitionResponse } from './employees.mapper';
import { EmployeesAccessService } from './employees-access.service';

@Injectable()
export class EmployeesShiftDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
  ) {}

  async listShiftDefinitions(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeeShiftDefinitionResponseDto[]> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'staff:view',
    );
    const rows = await this.prisma.employeeShiftDefinition.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEmployeeShiftDefinitionResponse);
  }

  async createShiftDefinition(
    user: AuthenticatedUser,
    dto: CreateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'staff:create',
    );
    const payload = this.normalizePayload(dto);
    await this.ensureNameAvailable(storeId, payload.name);

    try {
      const definition = await this.prisma.employeeShiftDefinition.create({
        data: {
          storeId,
          name: payload.name,
          defaultStartTime: payload.defaultStartTime,
          defaultEndTime: payload.defaultEndTime,
        },
      });
      return toEmployeeShiftDefinitionResponse(definition);
    } catch (error) {
      this.rethrowConflictIfNeeded(error);
      throw error;
    }
  }

  async updateShiftDefinition(
    user: AuthenticatedUser,
    definitionId: number,
    dto: UpdateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    const existing = await this.prisma.employeeShiftDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!existing) {
      throw new NotFoundException('班次定义不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );

    const payload = this.normalizePayload({
      name: dto.name ?? existing.name,
      defaultStartTime: dto.defaultStartTime ?? existing.defaultStartTime,
      defaultEndTime: dto.defaultEndTime ?? existing.defaultEndTime,
    });
    await this.ensureNameAvailable(existing.storeId, payload.name, existing.id);

    try {
      const updated = await this.prisma.employeeShiftDefinition.update({
        where: { id: existing.id },
        data: {
          name: payload.name,
          defaultStartTime: payload.defaultStartTime,
          defaultEndTime: payload.defaultEndTime,
        },
      });
      return toEmployeeShiftDefinitionResponse(updated);
    } catch (error) {
      this.rethrowConflictIfNeeded(error);
      throw error;
    }
  }

  async removeShiftDefinition(
    user: AuthenticatedUser,
    definitionId: number,
  ): Promise<void> {
    const existing = await this.prisma.employeeShiftDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!existing) {
      throw new NotFoundException('班次定义不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );
    await this.prisma.employeeShiftDefinition.delete({
      where: { id: existing.id },
    });
  }

  async findShiftDefinitionForStoreOrThrow(
    storeId: number,
    shiftDefinitionId: number,
  ) {
    const definition = await this.prisma.employeeShiftDefinition.findUnique({
      where: { id: shiftDefinitionId },
    });
    if (!definition) {
      throw new NotFoundException('班次定义不存在');
    }
    if (definition.storeId !== storeId) {
      throw new ForbiddenException('不能使用其他门店的班次定义');
    }
    return definition;
  }

  private normalizePayload(input: {
    name: string;
    defaultStartTime: string;
    defaultEndTime: string;
  }) {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('班次名称不能为空');
    }

    const defaultStartTime = input.defaultStartTime.trim();
    const defaultEndTime = input.defaultEndTime.trim();
    const startMinutes = parseTimeToMinutes(
      defaultStartTime,
      '默认上班时间格式不正确，请使用 HH:mm',
    );
    const endMinutes = parseTimeToMinutes(
      defaultEndTime,
      '默认下班时间格式不正确，请使用 HH:mm',
    );
    if (startMinutes >= endMinutes) {
      throw new BadRequestException('班次开始时间必须早于结束时间');
    }

    return {
      name,
      defaultStartTime,
      defaultEndTime,
    };
  }

  private async ensureNameAvailable(
    storeId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const existing = await this.prisma.employeeShiftDefinition.findFirst({
      where: {
        storeId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException('已存在同名班次定义，请换个名称');
    }
  }

  private rethrowConflictIfNeeded(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('已存在同名班次定义，请换个名称');
    }
  }
}
