import { ConflictException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { CreateMemberDto } from './dto/create-member.dto';
import {
  MemberMetaQueryDto,
  MembersMetaResponseDto,
} from './dto/member-meta.dto';
import {
  MemberOverviewQueryDto,
  MembersOverviewResponseDto,
} from './dto/member-overview.dto';
import {
  ListMembersQueryDto,
  ListMemberSnapshotsQueryDto,
  MemberResponseDto,
  MemberSnapshotDto,
  PaginatedMembersResponseDto,
} from './dto/member-response.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MembersAccessService } from './members-access.service';
import { MembersReadService } from './members-read.service';
import {
  prepareMemberCreateInput,
  prepareMemberUpdateInput,
} from './members.domain';
import { type MemberRecord, toMemberResponse } from './members.mapper';
import {
  queryMemberRechargeHistory,
  replaceMemberRechargeHistory,
  deleteMemberRecord,
  insertMemberRecord,
  updateMemberRecord,
} from './members.query';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membersAccessService: MembersAccessService,
    private readonly membersReadService: MembersReadService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateMemberDto,
  ): Promise<MemberResponseDto> {
    await this.membersAccessService.ensureCanManageMembers(
      user,
      dto.storeId,
      'members:create',
    );

    const prepared = prepareMemberCreateInput(dto.storeId, dto.name, {
      phone: dto.phone,
      gender: dto.gender,
      status: dto.status,
      remark: dto.remark,
      birthday: dto.birthday,
      beanBalance: dto.beanBalance,
      isPartner: dto.isPartner,
      partnerLevel: dto.partnerLevel,
      rechargeHistory: dto.rechargeHistory,
      bannedReason: dto.bannedReason,
    });
    await this.ensurePhoneUnique(dto.storeId, prepared.phone ?? undefined);

    const operatorStaffId =
      prepared.rechargeHistory.length > 0
        ? await this.membersAccessService.findOperatorStaffIdForStore(
            user,
            dto.storeId,
          )
        : null;

    const member = await this.prisma.$transaction(async (transaction) => {
      const createdMember = await insertMemberRecord(transaction, prepared);

      if (prepared.rechargeHistory.length > 0) {
        await replaceMemberRechargeHistory(transaction, {
          memberId: createdMember.id,
          storeId: createdMember.storeId,
          rechargeHistory: prepared.rechargeHistory,
          operatorStaffId,
        });
      }

      return createdMember;
    });

    await this.invalidateMembersDerived(member.storeId);
    return this.buildMemberResponse(member);
  }

  list(
    user: AuthenticatedUser,
    query: ListMembersQueryDto,
  ): Promise<PaginatedMembersResponseDto> {
    return this.membersReadService.list(user, query);
  }

  getMeta(
    user: AuthenticatedUser,
    query: MemberMetaQueryDto,
  ): Promise<MembersMetaResponseDto> {
    return this.membersReadService.getMeta(user, query);
  }

  getOverview(
    user: AuthenticatedUser,
    query: MemberOverviewQueryDto,
  ): Promise<MembersOverviewResponseDto> {
    return this.membersReadService.getOverview(user, query);
  }

  warmMetaCache(storeId: number): Promise<MembersMetaResponseDto> {
    return this.membersReadService.warmMetaCache(storeId);
  }

  warmOverviewCache(storeId: number): Promise<MembersOverviewResponseDto> {
    return this.membersReadService.warmOverviewCache(storeId);
  }

  listSnapshots(
    user: AuthenticatedUser,
    query: ListMemberSnapshotsQueryDto,
  ): Promise<MemberSnapshotDto[]> {
    return this.membersReadService.listSnapshots(user, query);
  }

  getDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<MemberResponseDto> {
    return this.membersReadService.getDetail(user, memberId);
  }

  async update(
    user: AuthenticatedUser,
    memberId: number,
    dto: UpdateMemberDto,
  ): Promise<MemberResponseDto> {
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        memberId,
        'members:update',
      );
    const prepared = prepareMemberUpdateInput(existingMember, {
      name: dto.name,
      phone: dto.phone,
      gender: dto.gender,
      status: dto.status,
      remark: dto.remark,
      birthday: dto.birthday,
      beanBalance: dto.beanBalance,
      isPartner: dto.isPartner,
      partnerLevel: dto.partnerLevel,
      rechargeHistory: dto.rechargeHistory,
      bannedReason: dto.bannedReason,
    });

    await this.ensurePhoneUnique(
      existingMember.storeId,
      prepared.normalizedPhone,
      existingMember.id,
    );

    if (
      prepared.assignments.length === 0 &&
      prepared.rechargeHistory === undefined
    ) {
      return this.buildMemberResponse(existingMember);
    }

    const operatorStaffId =
      prepared.rechargeHistory !== undefined
        ? await this.membersAccessService.findOperatorStaffIdForStore(
            user,
            existingMember.storeId,
          )
        : null;

    const member = await this.prisma.$transaction(async (transaction) => {
      const updatedMember =
        prepared.assignments.length > 0
          ? await updateMemberRecord(
              transaction,
              existingMember.id,
              prepared.assignments,
            )
          : existingMember;

      if (prepared.rechargeHistory !== undefined) {
        await replaceMemberRechargeHistory(transaction, {
          memberId: updatedMember.id,
          storeId: updatedMember.storeId,
          rechargeHistory: prepared.rechargeHistory,
          operatorStaffId,
        });
      }

      return updatedMember;
    });

    await this.invalidateMembersDerived(member.storeId);
    return this.buildMemberResponse(member);
  }

  async remove(user: AuthenticatedUser, memberId: number): Promise<void> {
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        memberId,
        'members:update',
      );

    await this.prisma.$transaction(async (tx) => {
      await deleteMemberRecord(tx, existingMember.id);

      // 软删除关联的 MarketingCustomer 档案：
      // 通过 customerId 外键（Step 2 新增）或 storeId + phone 兜底
      const now = new Date();
      if (existingMember.customerId) {
        await tx.marketingCustomer.update({
          where: { id: existingMember.customerId },
          data: { deletedAt: now },
        });
      } else if (existingMember.phone) {
        await tx.marketingCustomer.updateMany({
          where: {
            storeId: existingMember.storeId,
            phone: existingMember.phone,
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
      }
    });

    await this.invalidateMembersDerived(existingMember.storeId);
  }

  private async invalidateMembersDerived(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateMembersDerived(storeId);
  }

  private async ensurePhoneUnique(
    storeId: number,
    phone?: string,
    excludeMemberId?: number,
  ): Promise<void> {
    if (phone === undefined) {
      return;
    }

    const existingMember = await this.prisma.member.findFirst({
      where: {
        storeId,
        phone,
        ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
      },
      select: { id: true },
    });

    if (existingMember) {
      throw new ConflictException('该门店下会员手机号已存在');
    }
  }

  private async buildMemberResponse(
    member: MemberRecord,
  ): Promise<MemberResponseDto> {
    const rechargeRecords = await queryMemberRechargeHistory(
      this.prisma,
      member.id,
    );
    return toMemberResponse(member, rechargeRecords);
  }
}
