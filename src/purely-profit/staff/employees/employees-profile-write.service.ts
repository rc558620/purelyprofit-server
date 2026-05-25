import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { EmployeeResponseDto } from './dto/employee-response.dto';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesDictionaryService } from './employees-dictionary.service';
import {
  buildCreateEmployeeProfileData,
  buildNextEmployeeEmpNo,
  buildResignEmployeeProfileData,
  buildUpdateEmployeeProfileData,
} from './employees-profile.domain';
import { toEmployeeResponse } from './employees.mapper';
import {
  createEmployeeProfile,
  queryLatestEmployeeProfileEmpNo,
  updateEmployeeProfile,
} from './employees-profile.query';

@Injectable()
export class EmployeesProfileWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly employeesDictionaryService: EmployeesDictionaryService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const storeId = await this.resolveManageableStoreId(
      user,
      dto.storeId,
      'staff:create',
    );

    await this.platformMembershipAccessService.ensureEmployeeQuotaAvailable(
      storeId,
    );
    const [department, position, latestEmpNo] = await Promise.all([
      this.employeesDictionaryService.ensureDepartment(storeId, dto.department),
      this.employeesDictionaryService.ensurePosition(storeId, dto.position),
      queryLatestEmployeeProfileEmpNo(this.prisma, storeId),
    ]);
    const employee = await createEmployeeProfile(
      this.prisma,
      buildCreateEmployeeProfileData({
        storeId,
        department,
        position,
        empNo: buildNextEmployeeEmpNo(latestEmpNo),
        name: dto.name,
        phone: dto.phone,
        joinDate: dto.joinDate,
        baseSalary: dto.baseSalary,
        avatar: dto.avatar,
        idCard: dto.idCard,
        gender: dto.gender,
        emergencyContact: dto.emergencyContact,
        emergencyPhone: dto.emergencyPhone,
        contractEndDate: dto.contractEndDate,
        note: dto.note,
      }),
    );

    return toEmployeeResponse(employee);
  }

  async update(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const [department, position] = await Promise.all([
      dto.department
        ? this.employeesDictionaryService.ensureDepartment(
            employee.storeId,
            dto.department,
          )
        : Promise.resolve(undefined),
      dto.position
        ? this.employeesDictionaryService.ensurePosition(
            employee.storeId,
            dto.position,
          )
        : Promise.resolve(undefined),
    ]);

    const updated = await updateEmployeeProfile(
      this.prisma,
      employee.id,
      buildUpdateEmployeeProfileData({
        department,
        position,
        name: dto.name,
        phone: dto.phone,
        joinDate: dto.joinDate,
        baseSalary: dto.baseSalary,
        avatar: dto.avatar,
        idCard: dto.idCard,
        gender: dto.gender,
        emergencyContact: dto.emergencyContact,
        emergencyPhone: dto.emergencyPhone,
        contractEndDate: dto.contractEndDate,
        note: dto.note,
      }),
    );

    return toEmployeeResponse(updated);
  }

  async resign(
    user: AuthenticatedUser,
    employeeId: number,
    dto: ResignEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const resigned = await updateEmployeeProfile(
      this.prisma,
      employee.id,
      buildResignEmployeeProfileData(dto),
    );

    return toEmployeeResponse(resigned);
  }

  async remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    await this.prisma.employee.delete({
      where: { id: employee.id },
    });
  }

  private async resolveManageableStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    permission: 'staff:create' | 'staff:update',
  ): Promise<number> {
    return this.employeesAccessService.resolveSingleStoreId(
      user,
      storeId,
      permission,
    );
  }
}
