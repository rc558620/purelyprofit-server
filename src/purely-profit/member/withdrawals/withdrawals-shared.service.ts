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
  mapWithdrawalRecord,
  withdrawalRecordSelect,
  type WithdrawalRecordSnapshot,
} from './withdrawals.mapper';

const PROCESSING_WITHDRAWAL_STATUSES: PartnerWithdrawalStatus[] = [
  PartnerWithdrawalStatus.pending,
  PartnerWithdrawalStatus.approved,
];

const withdrawalOverviewPartnerSelect = {
  status: true,
  beanBalance: true,
  totalWithdrawnBeans: true,
} satisfies Prisma.StorePartnerSelect;

const withdrawalApplyPartnerSelect = {
  id: true,
  status: true,
  beanBalance: true,
} satisfies Prisma.StorePartnerSelect;

type PrismaExecutor = PrismaService | Prisma.TransactionClient;

type WithdrawalOverviewPartnerSnapshot = Prisma.StorePartnerGetPayload<{
  select: typeof withdrawalOverviewPartnerSelect;
}>;

type WithdrawalApplyPartnerSnapshot = Prisma.StorePartnerGetPayload<{
  select: typeof withdrawalApplyPartnerSelect;
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
  ): Promise<WithdrawalApplyPartnerSnapshot> {
    const partner = await this.prisma.storePartner.findUnique({
      where: { storeId },
      select: withdrawalApplyPartnerSelect,
    });

    if (!partner || partner.status !== 'approved') {
      throw new ForbiddenException(
        '当前账号尚未通过合伙人审核，暂不可申请提现',
      );
    }

    return partner;
  }

  async buildOverview(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<WithdrawalOverviewResponseDto> {
    const [partner, pendingCount] = await Promise.all([
      prismaExecutor.storePartner.findUnique({
        where: { storeId },
        select: withdrawalOverviewPartnerSelect,
      }),
      prismaExecutor.partnerWithdrawal.count({
        where: {
          storeId,
          status: { in: PROCESSING_WITHDRAWAL_STATUSES },
        },
      }),
    ]);

    return this.mapWithdrawalOverview(partner, pendingCount);
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
    partner: WithdrawalOverviewPartnerSnapshot | null,
    pendingCount: number,
  ): WithdrawalOverviewResponseDto {
    if (!partner || partner.status !== 'approved') {
      return {
        beanBalance: 0,
        totalWithdrawnBeans: 0,
        pendingCount,
      };
    }

    return {
      beanBalance: partner.beanBalance,
      totalWithdrawnBeans: partner.totalWithdrawnBeans,
      pendingCount,
    };
  }
}
