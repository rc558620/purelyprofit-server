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
  buildResignEmployeeProfileData,
  buildUpdateEmployeeProfileData,
  resolveNextEmployeeEmpNo,
} from './employees-profile.domain';
import { buildUserCacheKey } from '../../auth/auth.utils';
import { toEmployeeResponse } from './employees.mapper';
import { createEmployeeProfile } from './employees-profile.query';
import { EmployeesSnapshotSyncService } from './employees-snapshot-sync.service';

/**
 * 员工发号/额度校验的 advisory lock 命名空间。
 *
 * 与库内其它 advisory lock 通过第一个 int4 key 隔离，第二个 key 用 storeId，
 * 保证「同门店串行、跨门店并行」。
 */
const EMPLOYEE_WRITE_LOCK_NAMESPACE = 1017;

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

    const [department, position] = await Promise.all([
      this.employeesDictionaryService.ensureDepartment(storeId, dto.department),
      this.employeesDictionaryService.ensurePosition(storeId, dto.position),
    ]);

    // 发号与额度校验必须串行：事务级 advisory lock 让同门店的新增排队，
    // 否则两个并发请求会读到同一个最大工号 / 同一个在职人数。
    const employee = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${EMPLOYEE_WRITE_LOCK_NAMESPACE}, ${storeId})`;

      await this.platformMembershipAccessService.ensureEmployeeQuotaAvailable(
        storeId,
        transaction,
      );

      const empNo = await this.resolveNextEmpNo(transaction, storeId);
      return createEmployeeProfile(
        transaction,
        buildCreateEmployeeProfileData({
          storeId,
          department,
          position,
          empNo,
          name: dto.name,
          phone: dto.phone,
          isTechnician: dto.isTechnician,
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
          isTechnician: dto.isTechnician,
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

    // #16 / H-03 修复：两类缓存失效互不依赖，并行执行省一次串行 RTT
    await Promise.all([
      this.invalidateDashboardCaches(employee.storeId),
      employee.linkedStaffId
        ? this.invalidateLinkedUserAuthCache(employee.linkedStaffId)
        : Promise.resolve(),
    ]);

    return toEmployeeResponse(resigned);
  }

  async remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    // 删除会禁用关联登录并释放子账号槽位，属于独立高危操作，
    // 与前端 staff:delete 控权口径保持一致，不能降级为 staff:update。
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:delete',
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

    // #15 / H-03 修复：两类缓存失效互不依赖，并行执行省一次串行 RTT
    await Promise.all([
      this.invalidateDashboardCaches(storeId),
      employee.linkedStaffId
        ? this.invalidateLinkedUserAuthCache(employee.linkedStaffId)
        : Promise.resolve(),
    ]);
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
   * 在已持有门店 advisory lock 的事务内发号。
   *
   * 取该门店全部存量工号（含已软删除员工）的最大序号 +1：
   * - 含软删除行，避免复用被唯一约束占用的号；
   * - 按序号最大值而非「最后一条记录」计算，避免历史脏数据导致撞号。
   */
  private async resolveNextEmpNo(
    transaction: Prisma.TransactionClient,
    storeId: number,
  ): Promise<string> {
    const existing = await transaction.employee.findMany({
      where: { storeId },
      select: { empNo: true },
    });
    return resolveNextEmployeeEmpNo(existing.map((item) => item.empNo));
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
