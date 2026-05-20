import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffStatus } from '@prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { type MemberRecord } from './members.mapper';

export type MembersPermission =
  | 'members:view'
  | 'members:create'
  | 'members:update';

const MEMBER_SELECT_SQL = Prisma.sql`
  SELECT
    id,
    store_id AS "storeId",
    name,
    phone,
    gender,
    level,
    note,
    birthday,
    last_consume_at AS "lastConsumeAt",
    points,
    total_points_earned AS "totalPointsEarned",
    bean_balance AS "beanBalance",
    is_partner AS "isPartner",
    partner_level AS "partnerLevel",
    total_recharged AS "totalRecharged",
    recharge_count AS "rechargeCount",
    invited_count AS "invitedCount",
    banned_reason AS "bannedReason",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM members
`;

@Injectable()
export class MembersAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async resolveMembersViewStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
  ): Promise<number | null> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      'members:view',
    );

    if (manageableStoreId === null) {
      if (storeId !== undefined) {
        throw new ForbiddenException(forbiddenMessage);
      }
      return null;
    }

    if (storeId !== undefined && manageableStoreId !== storeId) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return storeId ?? manageableStoreId;
  }

  async ensureCanManageMembers(
    user: AuthenticatedUser,
    storeId: number,
    requiredPermission: MembersPermission,
  ): Promise<void> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      requiredPermission,
    );

    if (manageableStoreId !== storeId) {
      throw new ForbiddenException('无权操作该门店会员');
    }
  }

  async getManageableStoreId(
    user: AuthenticatedUser,
    requiredPermission: MembersPermission,
  ): Promise<number | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        OR: [{ userId: user.id }, { email: user.email }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        storeId: true,
        role: true,
        permissions: true,
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

  async findManageableMemberOrThrow(
    user: AuthenticatedUser,
    memberId: number,
    requiredPermission: 'members:view' | 'members:update',
  ): Promise<MemberRecord> {
    const rows = await this.prisma.$queryRaw<MemberRecord[]>`
      ${MEMBER_SELECT_SQL}
      WHERE id = ${memberId}
      LIMIT 1
    `;
    const member = rows[0];

    if (!member) {
      throw new NotFoundException('会员不存在');
    }

    await this.ensureCanManageMembers(user, member.storeId, requiredPermission);
    return member;
  }

  async findOperatorStaffIdForStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<number | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        storeId,
        OR: [{ userId: user.id }, { email: user.email }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        id: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    return staff?.id ?? null;
  }
}
