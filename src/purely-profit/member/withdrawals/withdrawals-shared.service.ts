import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PARTNER_WITHDRAWAL_MAX_BEANS,
  PARTNER_WITHDRAWAL_MIN_BEANS,
} from './dto/apply-withdrawal.dto';
import type {
  ApplyWithdrawalResponseDto,
  ReviewWithdrawalResponseDto,
  WithdrawalOverviewResponseDto,
} from './dto/withdrawal-response.dto';
import {
  buildApprovedPartnerResponse,
  buildApprovedPartnersResponse,
  buildBeanOverview,
} from '../platform-membership/platform-membership.domain';
import {
  mapWithdrawalRecord,
  withdrawalRecordSelect,
  type WithdrawalRecordSnapshot,
} from './withdrawals.mapper';

const PROCESSING_WITHDRAWAL_STATUSES: PartnerWithdrawalStatus[] = [
  PartnerWithdrawalStatus.pending,
  PartnerWithdrawalStatus.approved,
];

const withdrawalPartnerSelect = {
  id: true,
  status: true,
  name: true,
  phone: true,
  beanBalance: true,
  totalEarnedBeans: true,
  totalWithdrawnBeans: true,
  joinedAt: true,
  store: {
    select: {
      owner: {
        select: {
          avatar: true,
        },
      },
    },
  },
} satisfies Prisma.StorePartnerSelect;

type PrismaExecutor = PrismaService | Prisma.TransactionClient;

type WithdrawalPartnerSnapshot = Prisma.StorePartnerGetPayload<{
  select: typeof withdrawalPartnerSelect;
}>;

@Injectable()
export class WithdrawalsSharedService {
  constructor(private readonly prisma: PrismaService) {}

  getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;

    if (!storeId) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }

    return storeId;
  }

  ensureWithdrawAmountWithinFrontEndRange(beanAmount: number): void {
    if (beanAmount < PARTNER_WITHDRAWAL_MIN_BEANS) {
      throw new ConflictException(
        `最低提现 ${PARTNER_WITHDRAWAL_MIN_BEANS} 豆`,
      );
    }

    if (beanAmount > PARTNER_WITHDRAWAL_MAX_BEANS) {
      throw new ConflictException(
        `单次最多提现 ${PARTNER_WITHDRAWAL_MAX_BEANS} 豆`,
      );
    }
  }

  normalizeAccountInfoOrThrow(
    accountNo: string,
    accountName: string,
  ): { accountNo: string; accountName: string } {
    const trimmedAccountNo = accountNo.trim();
    const trimmedAccountName = accountName.trim();

    if (trimmedAccountNo === '' || trimmedAccountName === '') {
      throw new ConflictException('收款信息不能为空');
    }

    return {
      accountNo: trimmedAccountNo,
      accountName: trimmedAccountName,
    };
  }

  async findApprovedPartnerForApplyOrThrow(
    storeId: number,
    rawPartnerId?: string,
  ): Promise<WithdrawalPartnerSnapshot> {
    const where: Prisma.StorePartnerWhereInput = {
      storeId,
      status: 'approved',
    };

    if (rawPartnerId !== undefined) {
      const partnerId = Number(rawPartnerId);
      if (!Number.isInteger(partnerId) || partnerId <= 0) {
        throw new ConflictException('合伙人 ID 不合法');
      }

      where.id = partnerId;
    }

    const partner = await this.prisma.storePartner.findFirst({
      where,
      select: withdrawalPartnerSelect,
      orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
    });

    if (!partner || partner.status !== 'approved') {
      throw new ForbiddenException(
        rawPartnerId
          ? '指定合伙人不存在或暂不可提现'
          : '当前账号尚未通过合伙人审核，暂不可申请提现',
      );
    }

    return partner;
  }

  async buildOverview(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<WithdrawalOverviewResponseDto> {
    const [partners, pendingCount] = await Promise.all([
      prismaExecutor.storePartner.findMany({
        where: { storeId, status: 'approved' },
        select: withdrawalPartnerSelect,
        orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
      }),
      prismaExecutor.partnerWithdrawal.count({
        where: {
          storeId,
          status: { in: PROCESSING_WITHDRAWAL_STATUSES },
        },
      }),
    ]);

    return this.mapWithdrawalOverview(partners, pendingCount);
  }

  async buildOperationResponse(
    prismaExecutor: PrismaExecutor,
    storeId: number,
    record: WithdrawalRecordSnapshot,
  ): Promise<ApplyWithdrawalResponseDto | ReviewWithdrawalResponseDto> {
    return {
      record: mapWithdrawalRecord(record),
      overview: await this.buildOverview(prismaExecutor, storeId),
    };
  }

  async getScopedWithdrawalOrThrow(
    user: AuthenticatedUser,
    withdrawalId: number,
  ): Promise<WithdrawalRecordSnapshot> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const record = await this.findWithdrawalByIdOrThrow(
      this.prisma,
      withdrawalId,
    );

    if (record.storeId !== storeId) {
      throw new ForbiddenException('无权操作该提现记录');
    }

    return record;
  }

  async findWithdrawalByIdOrThrow(
    prismaExecutor: PrismaExecutor,
    withdrawalId: number,
  ): Promise<WithdrawalRecordSnapshot> {
    const record = await prismaExecutor.partnerWithdrawal.findUnique({
      where: { id: withdrawalId },
      select: withdrawalRecordSelect,
    });

    if (!record) {
      throw new NotFoundException('提现记录不存在');
    }

    return record;
  }

  private mapWithdrawalOverview(
    partners: WithdrawalPartnerSnapshot[],
    pendingCount: number,
  ): WithdrawalOverviewResponseDto {
    const primaryPartner = partners[0] ?? null;
    const overview = buildBeanOverview(partners);

    return {
      approvedPartner: buildApprovedPartnerResponse(primaryPartner),
      approvedPartners: buildApprovedPartnersResponse(partners),
      beanBalance: overview.beanBalance,
      totalWithdrawnBeans: overview.totalWithdrawnBeans,
      pendingCount,
    };
  }
}
