import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffRole, StaffStatus } from '@prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { ActivateStaffDto } from './dto/activate-staff.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { StaffActivationResponseDto } from './dto/staff-activation-response.dto';
import { StaffInviteResponseDto } from './dto/staff-invite-response.dto';
import {
  ListStaffQueryDto,
  PaginatedStaffResponseDto,
  StaffResponseDto,
} from './dto/staff-response.dto';
import { PaginationMetaDto } from '../../stores/dto/store-response.dto';
import { StoreSeatSummaryDto } from './dto/store-seat-summary.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateStaffDto,
  ): Promise<StaffResponseDto> {
    const result = await this.invite(user, dto);
    return result.staff;
  }

  async invite(
    user: AuthenticatedUser,
    dto: InviteStaffDto,
  ): Promise<StaffInviteResponseDto> {
    await this.ensureCanManageStaff(user, dto.storeId, 'staff:create');

    const normalizedEmail = dto.email.toLowerCase();
    await this.ensureAccountCanOnlyBindSingleStore(
      dto.storeId,
      normalizedEmail,
    );
    const existingStaff = await this.prisma.staff.findFirst({
      where: {
        storeId: dto.storeId,
        email: normalizedEmail,
      },
    });

    if (existingStaff) {
      throw new ConflictException('该门店下员工邮箱已存在');
    }

    const linkedUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    const invitePhone = dto.phone;

    const staff = await this.prisma.staff.create({
      data: {
        storeId: dto.storeId,
        userId: linkedUser?.id,
        email: normalizedEmail,
        name: dto.name,
        ...(invitePhone !== undefined ? { phone: invitePhone } : {}),
        role: dto.role ?? StaffRole.STAFF,
        permissions: dto.permissions ?? [],
        status: StaffStatus.INVITED,
        isSeatActive: false,
        isActive: true,
      },
    });

    const seatSummary = await this.getSeatSummary(dto.storeId);

    return {
      status: staff.status,
      message: linkedUser
        ? '员工已创建，待老板激活后占用账号席位'
        : '员工已创建，待注册或激活后占用账号席位',
      staff,
      seatSummary,
    };
  }

  async activate(
    user: AuthenticatedUser,
    dto: ActivateStaffDto,
  ): Promise<StaffActivationResponseDto> {
    const normalizedEmail = dto.email.toLowerCase();
    await this.ensureAccountCanOnlyBindSingleStore(
      dto.storeId,
      normalizedEmail,
      user.id,
    );
    const staff = await this.prisma.staff.findFirst({
      where: {
        storeId: dto.storeId,
        email: normalizedEmail,
      },
    });

    if (!staff) {
      throw new NotFoundException('员工邀请记录不存在');
    }

    const linkedUserId = staff.userId ?? user.id;
    if (linkedUserId !== user.id) {
      throw new ForbiddenException('该账号无权激活此员工席位');
    }

    if (staff.status === StaffStatus.DISABLED) {
      throw new ForbiddenException('当前员工已被禁用，无法激活');
    }

    if (!staff.isSeatActive) {
      await this.ensureSeatAvailable(staff.storeId);
    }

    const activatedStaff = await this.prisma.staff.update({
      where: { id: staff.id },
      data: {
        userId: user.id,
        status: StaffStatus.ACTIVE,
        isSeatActive: true,
        isActive: true,
      },
    });

    const seatSummary = await this.getSeatSummary(staff.storeId);

    return {
      status: activatedStaff.status,
      message: '员工账号已激活，可登录系统',
      staff: activatedStaff,
      seatSummary,
    };
  }

  async list(
    user: AuthenticatedUser,
    query: ListStaffQueryDto,
  ): Promise<PaginatedStaffResponseDto> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      'staff:view',
    );
    const { page, pageSize, storeId, status, role, keyword } = query;
    const {
      page: currentPage,
      skip,
      take,
    } = this.resolvePagination(page, pageSize);

    if (
      manageableStoreId === null ||
      (storeId !== undefined && manageableStoreId !== storeId)
    ) {
      return {
        items: [],
        meta: this.buildPaginationMeta(0, currentPage, take),
      };
    }

    const where = {
      storeId: storeId ?? manageableStoreId,
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' as const } },
              { email: { contains: keyword, mode: 'insensitive' as const } },
              { phone: { contains: keyword } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.staff.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.staff.count({ where }),
    ]);

    return {
      items,
      meta: this.buildPaginationMeta(total, currentPage, take),
    };
  }

  async update(
    user: AuthenticatedUser,
    staffId: number,
    dto: UpdateStaffDto,
  ): Promise<StaffResponseDto> {
    const existingStaff = await this.findManageableStaffOrThrow(
      user,
      staffId,
      'staff:update',
    );

    const updatePhone = dto.phone;

    return this.prisma.staff.update({
      where: { id: existingStaff.id },
      data: {
        name: dto.name,
        ...(updatePhone !== undefined ? { phone: updatePhone } : {}),
        role: dto.role,
        permissions: dto.permissions,
        status:
          dto.isActive === false
            ? StaffStatus.DISABLED
            : dto.isActive === true
              ? StaffStatus.ACTIVE
              : undefined,
        isSeatActive:
          dto.isActive === false
            ? false
            : dto.isActive === true
              ? true
              : undefined,
        isActive: dto.isActive,
      },
    });
  }

  async remove(user: AuthenticatedUser, staffId: number): Promise<void> {
    const existingStaff = await this.findManageableStaffOrThrow(
      user,
      staffId,
      'staff:delete',
    );

    await this.prisma.staff.delete({
      where: { id: existingStaff.id },
    });
  }

  private async ensureAccountCanOnlyBindSingleStore(
    storeId: number,
    email: string,
    userId?: number,
  ): Promise<void> {
    const [ownedStore, existingMembership] = await Promise.all([
      userId
        ? this.prisma.store.findFirst({
            where: {
              ownerId: userId,
              id: { not: storeId },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.staff.findFirst({
        where: {
          storeId: { not: storeId },
          isActive: true,
          OR: userId ? [{ email }, { userId }] : [{ email }],
        },
        select: { id: true, storeId: true },
      }),
    ]);

    if (ownedStore || existingMembership) {
      throw new ConflictException(
        '一个账号只能绑定一个门店，请先解除原门店关系',
      );
    }
  }

  private async ensureCanManageStaff(
    user: AuthenticatedUser,
    storeId: number,
    requiredPermission: 'staff:create' | 'staff:update' | 'staff:delete',
  ): Promise<void> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      requiredPermission,
    );

    if (manageableStoreId !== storeId) {
      throw new ForbiddenException('无权操作该门店员工');
    }
  }

  private async getManageableStoreId(
    user: AuthenticatedUser,
    requiredPermission:
      | 'staff:view'
      | 'staff:create'
      | 'staff:update'
      | 'staff:delete',
  ): Promise<number | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        OR: [{ userId: user.id }, { email: user.email }, { phone: user.phone }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        id: true,
        storeId: true,
        role: true,
        permissions: true,
        isActive: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    if (!staff) {
      return null;
    }

    const effectivePermissions =
      this.accessControlService.getEffectivePermissions(staff);
    return this.accessControlService.hasPermission(
      effectivePermissions,
      requiredPermission,
    )
      ? staff.storeId
      : null;
  }

  private async findManageableStaffOrThrow(
    user: AuthenticatedUser,
    staffId: number,
    requiredPermission: 'staff:update' | 'staff:delete',
  ): Promise<{ id: number; storeId: number; role: StaffRole }> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        id: staffId,
      },
      select: { id: true, storeId: true, role: true },
    });

    if (!staff) {
      throw new NotFoundException('员工不存在');
    }

    await this.ensureCanManageStaff(user, staff.storeId, requiredPermission);

    if (staff.role === StaffRole.OWNER) {
      throw new ForbiddenException('不能直接修改或删除老板身份');
    }

    return staff;
  }

  private async ensureSeatAvailable(storeId: number): Promise<void> {
    const seatSummary = await this.getSeatSummary(storeId);

    if (seatSummary.availableSeatCount <= 0) {
      throw new ForbiddenException('当前门店账号席位不足，无法激活更多账号');
    }
  }

  private async getSeatSummary(storeId: number): Promise<StoreSeatSummaryDto> {
    return this.subscriptionsService.getSeatSummary(storeId);
  }

  private buildPaginationMeta(
    total: number,
    page: number,
    pageSize: number,
  ): PaginationMetaDto {
    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    };
  }

  private resolvePagination(
    page?: number,
    pageSize?: number,
  ): { page: number; skip: number; take: number } {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    const safePage = page && page > 0 ? page : 1;
    const safePageSize = pageSize && pageSize > 0 ? pageSize : defaultPageSize;
    const take = Math.min(safePageSize, maxPageSize);

    return {
      page: safePage,
      skip: (safePage - 1) * take,
      take,
    };
  }
}
