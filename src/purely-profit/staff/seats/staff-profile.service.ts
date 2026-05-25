import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffRole, StaffStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { StaffAccessService } from './staff-access.service';
import { queryStaffPage } from './staff.query';
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
import { StoreSeatSummaryDto } from './dto/store-seat-summary.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import {
  buildStaffListWhere,
  buildStaffPaginationMeta,
  normalizeStaffEmail,
  resolveStaffPagination,
} from './staff.utils';

@Injectable()
export class StaffProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAccessService: StaffAccessService,
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
    await this.staffAccessService.ensureCanManageStaff(
      user,
      dto.storeId,
      'staff:create',
    );

    const normalizedEmail = normalizeStaffEmail(dto.email);
    await this.staffAccessService.ensureAccountCanOnlyBindSingleStore(
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
    const normalizedEmail = normalizeStaffEmail(dto.email);
    await this.staffAccessService.ensureAccountCanOnlyBindSingleStore(
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
    const manageableStoreId = await this.staffAccessService.getManageableStoreId(
      user,
      'staff:view',
    );
    const { page: currentPage, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

    if (
      manageableStoreId === null ||
      (query.storeId !== undefined && manageableStoreId !== query.storeId)
    ) {
      return {
        items: [],
        meta: buildStaffPaginationMeta(0, currentPage, take),
      };
    }

    const result = await queryStaffPage(this.prisma, {
      where: buildStaffListWhere(query.storeId ?? manageableStoreId, {
        status: query.status,
        role: query.role,
        keyword: query.keyword,
      }),
      skip,
      take,
    });

    return {
      items: result.items,
      meta: buildStaffPaginationMeta(result.total, currentPage, take),
    };
  }

  async update(
    user: AuthenticatedUser,
    staffId: number,
    dto: UpdateStaffDto,
  ): Promise<StaffResponseDto> {
    const existingStaff = await this.staffAccessService.findManageableStaffOrThrow(
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
    const existingStaff = await this.staffAccessService.findManageableStaffOrThrow(
      user,
      staffId,
      'staff:delete',
    );

    await this.prisma.staff.delete({
      where: { id: existingStaff.id },
    });
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

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize = this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolveStaffPagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
