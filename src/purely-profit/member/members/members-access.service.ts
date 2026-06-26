import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { type MemberRecord } from './members.mapper';

export type MembersPermission =
  | 'members:view'
  | 'members:create'
  | 'members:update';

const MEMBER_SELECT_SQL = Prisma.sql`
  SELECT
    m.id,
    m.store_id AS "storeId",
    m.customer_id AS "customerId",
    m.name,
    m.phone,
    m.gender,
    m.note,
    m.birthday,
    m.bean_balance AS "beanBalance",
    m.is_partner AS "isPartner",
    m.partner_level AS "partnerLevel",
    m.banned_reason AS "bannedReason",
    m.status,
    m.created_at AS "createdAt",
    m.updated_at AS "updatedAt",
    CASE WHEN mc.id IS NOT NULL THEN
      jsonb_build_object(
        'id', mc.id,
        'tier', mc.tier::text,
        'points', mc.points,
        'totalSpent', mc.total_spent,
        'visitCount', mc.visit_count,
        'lastVisitAt', mc.last_visit_at,
        'balance', mc.balance
      )
    ELSE NULL END AS "customer"
  FROM members m
  LEFT JOIN marketing_customers mc ON mc.id = m.customer_id
    AND mc.deleted_at IS NULL
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

  getManageableStoreId(
    user: AuthenticatedUser,
    requiredPermission: MembersPermission,
  ): Promise<number | null> {
    return Promise.resolve(
      this.accessControlService.resolveCurrentStoreIdByPermission(
        user,
        requiredPermission,
      ),
    );
  }

  async findManageableMemberOrThrow(
    user: AuthenticatedUser,
    memberId: number,
    requiredPermission: 'members:view' | 'members:update',
  ): Promise<MemberRecord> {
    const rows = await this.prisma.$queryRaw<MemberRecord[]>`
      ${MEMBER_SELECT_SQL}
      WHERE m.id = ${memberId}
      LIMIT 1
    `;
    const member = rows[0];

    if (!member) {
      throw new NotFoundException('会员不存在');
    }

    await this.ensureCanManageMembers(user, member.storeId, requiredPermission);
    return member;
  }

  findOperatorStaffIdForStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<number | null> {
    return Promise.resolve(
      this.accessControlService.resolveCurrentStaffIdForStore(user, storeId),
    );
  }
}
