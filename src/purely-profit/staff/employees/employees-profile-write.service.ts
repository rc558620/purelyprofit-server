import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  EmployeeStatus,
  Prisma,
  StaffStatus,
  StoreSubAccountStatus,
  type Employee,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
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
import { buildUserCacheKey } from '../../auth/auth.utils';
import { toEmployeeResponse } from './employees.mapper';
import {
  createEmployeeProfile,
  queryLatestEmployeeProfileEmpNo,
} from './employees-profile.query';
import { EmployeesSnapshotSyncService } from './employees-snapshot-sync.service';

@Injectable()
export class EmployeesProfileWriteService {
  private static readonly logger = new Logger(
    EmployeesProfileWriteService.name,
  );
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly employeesDictionaryService: EmployeesDictionaryService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly cacheInvalidator: CacheInvalidatorService,
    private readonly redisService: RedisService,
    private readonly snapshotSyncService: EmployeesSnapshotSyncService,
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

    // #6 修复：使用事务避免编号冲突
    const employee = await this.prisma.$transaction(async (transaction) => {
      const empNo = await this.resolveNextEmpNo(
        transaction,
        storeId,
        latestEmpNo,
      );
      return createEmployeeProfile(
        transaction,
        buildCreateEmployeeProfileData({
          storeId,
          department,
          position,
          empNo,
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
    });

    // #17 修复：创建员工后触发首页缓存失效
    await this.invalidateDashboardCaches(storeId);

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

    // #7 修复：禁止修改已离职员工的在职信息
    if (employee.status === EmployeeStatus.resigned) {
      throw new BadRequestException('已离职员工不支持修改档案信息');
    }

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

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextEmployee = await transaction.employee.update({
        where: { id: employee.id },
        data: buildUpdateEmployeeProfileData({
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
      });

      await this.snapshotSyncService.syncEmployeeDependentSnapshots(
        transaction,
        employee,
        nextEmployee,
        dto,
        user.currentMembership?.staffId ?? null,
      );

      return nextEmployee;
    });

    await this.invalidateDashboardCaches(employee.storeId);

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

    if (employee.status === EmployeeStatus.resigned) {
      throw new BadRequestException('该员工已离职，无需重复办理');
    }

    const resigned = await this.prisma.$transaction(async (transaction) => {
      const nextEmployee = await transaction.employee.update({
        where: { id: employee.id },
        data: buildResignEmployeeProfileData(dto),
      });

      // #1 修复：离职后释放子账号槽位，使其可被重新分配
      await this.deactivateSubAccountOnResign(
        transaction,
        employee.storeId,
        employee.id,
      );

      // #1 修复：离职后禁用关联 Staff 登录态
      await this.deactivateLinkedStaff(transaction, employee);

      return nextEmployee;
    });

    // #16 修复：离职后触发首页缓存失效
    await this.invalidateDashboardCaches(employee.storeId);

    // H-03 修复：离职后失效关联 User 的认证缓存，避免已禁用账号在缓存 TTL 窗口内仍可访问 API
    if (employee.linkedStaffId) {
      await this.invalidateLinkedUserAuthCache(employee.linkedStaffId);
    }

    return toEmployeeResponse(resigned);
  }

  async remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const storeId = employee.storeId;

    await this.prisma.$transaction(async (transaction) => {
      // 删除员工前释放子账号槽位，使其可被重新分配
      await this.deactivateSubAccountOnResign(
        transaction,
        employee.storeId,
        employee.id,
      );

      // #2 修复：删除员工前禁用关联 Staff 登录态
      await this.deactivateLinkedStaff(transaction, employee);

      // 软删除：更新 deletedAt 字段而非物理删除
      await transaction.employee.update({
        where: { id: employee.id },
        data: { deletedAt: new Date() },
      });
    });

    // #15 修复：删除员工后触发首页缓存失效
    await this.invalidateDashboardCaches(storeId);

    // H-03 修复：删除员工后失效关联 User 的认证缓存，避免已禁用账号在缓存 TTL 窗口内仍可访问 API
    if (employee.linkedStaffId) {
      await this.invalidateLinkedUserAuthCache(employee.linkedStaffId);
    }
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

  /**
   * #6 修复：在事务内重新查询最新编号，避免并发冲突
   */
  private async resolveNextEmpNo(
    transaction: Prisma.TransactionClient,
    storeId: number,
    preFetchedLatestEmpNo: string | null,
  ): Promise<string> {
    const latestInTransaction = await transaction.employee.findFirst({
      where: { storeId, deletedAt: null },
      orderBy: { id: 'desc' },
      select: { empNo: true },
    });
    // 取 preFetch 和事务内查询中的较大值
    const latest = latestInTransaction?.empNo ?? preFetchedLatestEmpNo;
    return buildNextEmployeeEmpNo(latest);
  }

  /**
   * #1 修复：离职后释放子账号槽位，使其可被重新分配
   * 槽位是配额容器，员工离职仅解除绑定，槽位保持 active 以便复用
   */
  private async deactivateSubAccountOnResign(
    transaction: Prisma.TransactionClient,
    storeId: number,
    employeeId: number,
  ): Promise<void> {
    await transaction.storeSubAccount.updateMany({
      where: {
        storeId,
        employeeId,
      },
      data: {
        status: StoreSubAccountStatus.active,
        isAssigned: false,
        employeeId: null,
        assignedAt: null,
        canAccessHome: true,
        canUseHandover: true,
      },
    });
  }

  /**
   * 离职/删除员工时禁用关联 Staff 登录态并解除 Employee → Staff 关联
   */
  private async deactivateLinkedStaff(
    transaction: Prisma.TransactionClient,
    employee: Employee,
  ): Promise<void> {
    if (employee.linkedStaffId === null) {
      return;
    }

    // 用 updateMany 替代 findUnique + update，减少一次查询
    await transaction.staff.updateMany({
      where: { id: employee.linkedStaffId },
      data: { isActive: false, status: StaffStatus.disabled },
    });

    // 解除 Employee → Staff 关联，防止全局 User 被跨员工/跨租户复用
    await transaction.employee.updateMany({
      where: { id: employee.id, linkedStaffId: employee.linkedStaffId },
      data: { linkedStaffId: null },
    });
  }

  /**
   * 统一的首页缓存失效方法
   */
  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await this.cacheInvalidator.invalidateProfitDashboardHome(storeId);
  }

  /**
   * H-03 修复：根据 staffId 查找关联的 userId，失效其认证缓存。
   *
   * 员工离职/删除时 Staff 被禁用（isActive=false），但 User 表的 Redis 缓存
   * 仍有最长 5 分钟 TTL，导致 JWT 鉴权链路 resolveUser() 继续返回有效用户。
   * 此方法主动清除该缓存，确保禁用立即生效。
   */
  private async invalidateLinkedUserAuthCache(
    linkedStaffId: number,
  ): Promise<void> {
    try {
      const staff = await this.prisma.staff.findUnique({
        where: { id: linkedStaffId },
        select: { userId: true },
      });
      if (staff?.userId) {
        await this.redisService.del(buildUserCacheKey(staff.userId));
      }
    } catch (error: unknown) {
      // 缓存失效失败不影响主流程，记录警告即可
      EmployeesProfileWriteService.logger.warn(
        `[H-03] 失效关联 User 认证缓存失败 (staffId=${linkedStaffId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
