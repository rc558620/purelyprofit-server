import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { BEANS_INSUFFICIENT_MESSAGE } from './members-points.config';
import {
  applyMemberBeansAdjustment,
  insertMemberBeanOpeningLog,
} from './members-points.query';
import { type MemberRecord, toMemberResponse } from './members.mapper';
import {
  queryMemberRechargeHistory,
  replaceMemberRechargeHistory,
  deleteMemberRecord,
  insertMemberRecord,
  linkCustomerToMember,
  resolveOrCreateCustomerForMember,
  updateMemberRecord,
} from './members.query';

/** 编辑会员资料改动纯利豆时写入流水的说明文案 */
const MEMBER_BEAN_EDIT_REASON = '管理员编辑会员资料调整纯利豆';
/** 新建会员时带入初始纯利豆的开账流水说明文案 */
const MEMBER_BEAN_OPENING_REASON = '创建会员初始化纯利豆';
/**
 * members 表「同店未删除会员手机号唯一」的部分唯一索引名
 * （见迁移 20260922000000_add_members_phone_partial_unique）。
 * 用于从 raw SQL 的唯一冲突错误里精确识别手机号冲突。
 */
const MEMBERS_PHONE_UNIQUE_CONSTRAINT = 'uq_members_store_phone_active';

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
    const needsOperatorStaffId =
      prepared.rechargeHistory.length > 0 || prepared.beanBalance > 0;
    const operatorStaffId = needsOperatorStaffId
      ? await this.membersAccessService.findOperatorStaffIdForStore(
          user,
          dto.storeId,
        )
      : null;

    // 手机号唯一性交由 DB 的部分唯一索引保证，不再做「事务外先查后写」——
    // 后者存在 TOCTOU 窗口，并发建会员能插入同店重复号码。
    let member: MemberRecord;
    try {
      member = await this.prisma.$transaction(async (transaction) => {
        // 积分 / 等级 / 最近活跃的事实源在 marketing_customers：
        // 建会员必须同步建档并双向绑定，否则该会员的积分调整接口会直接不可用。
        const customerId = await resolveOrCreateCustomerForMember(transaction, {
          storeId: prepared.storeId,
          name: prepared.name,
          phone: prepared.phone,
        });
        const createdMember = await insertMemberRecord(
          transaction,
          prepared,
          customerId,
        );

        if (customerId !== null) {
          await linkCustomerToMember(transaction, customerId, createdMember.id);
        }

        if (prepared.rechargeHistory.length > 0) {
          await replaceMemberRechargeHistory(transaction, {
            memberId: createdMember.id,
            storeId: createdMember.storeId,
            rechargeHistory: prepared.rechargeHistory,
            operatorStaffId,
          });
        }

        // 初始纯利豆必须留痕，避免余额凭空出现且查不到来源
        await insertMemberBeanOpeningLog(transaction, {
          member: createdMember,
          operatorStaffId,
          reason: MEMBER_BEAN_OPENING_REASON,
        });

        return createdMember;
      });
    } catch (error) {
      throw this.mapPhoneConflict(error);
    }

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

    if (
      prepared.assignments.length === 0 &&
      prepared.rechargeHistory === undefined &&
      prepared.beanAdjustment === undefined
    ) {
      return this.buildMemberResponse(existingMember);
    }

    const operatorStaffId =
      prepared.rechargeHistory !== undefined ||
      prepared.beanAdjustment !== undefined
        ? await this.membersAccessService.findOperatorStaffIdForStore(
            user,
            existingMember.storeId,
          )
        : null;

    // 同 create：手机号唯一性由 DB 的部分唯一索引兜底，冲突在此统一转译。
    let member: MemberRecord;
    try {
      member = await this.prisma.$transaction(async (transaction) => {
        let updatedMember =
          prepared.assignments.length > 0
            ? await updateMemberRecord(
                transaction,
                existingMember.id,
                prepared.assignments,
              )
            : existingMember;

        // 纯利豆走与 /beans/adjust 同口径的「原子增量更新 + 流水」，
        // 不再直接赋值，避免无痕改余额与并发丢失更新。
        if (prepared.beanAdjustment) {
          const adjusted = await applyMemberBeansAdjustment(transaction, {
            member: updatedMember,
            operatorStaffId,
            delta: prepared.beanAdjustment.delta,
            reason: MEMBER_BEAN_EDIT_REASON,
            insufficientMessage: BEANS_INSUFFICIENT_MESSAGE,
          });
          updatedMember = adjusted.member;
        }

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
    } catch (error) {
      throw this.mapPhoneConflict(error);
    }

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
        // 必须同时解绑 member_id：该列有唯一约束，留着会让这份档案永远无法被
        // 其它会员复用（新建会员的同号档案匹配也依赖 member_id IS NULL）。
        await tx.marketingCustomer.update({
          where: { id: existingMember.customerId },
          data: { deletedAt: now, memberId: null },
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

  /**
   * 识别「同店手机号重复」。
   *
   * 注意：写会员走的是 $queryRaw，Prisma 对 raw 查询违反唯一约束抛的是
   * **P2010**（raw query error）而不是 P2002，只能从原生错误信息里匹配约束名。
   */
  private isDuplicateMemberPhoneError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2010' &&
      error.message.includes(MEMBERS_PHONE_UNIQUE_CONSTRAINT)
    );
  }

  /** 把 DB 层的手机号唯一冲突转成业务异常，其它错误原样抛出 */
  private mapPhoneConflict(error: unknown): unknown {
    return this.isDuplicateMemberPhoneError(error)
      ? new ConflictException('该门店下会员手机号已存在')
      : error;
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
