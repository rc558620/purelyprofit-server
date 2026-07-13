import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
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
import { buildApprovedPartnerResponse } from '../platform-membership/platform-membership.domain';
import {
  mapWithdrawalRecord,
  withdrawalRecordSelect,
  type WithdrawalRecordSnapshot,
} from './withdrawals.mapper';

/** 提现金额计算结果——全模块唯一计算源 */
export interface WithdrawalAmounts {
  /** 提现豆数 */
  beanAmount: number;
  /** 对应人民币金额（分）——由 Money.fromBeanAmount 统一换算 */
  rmbAmount: number;
  /** 实际到账人民币金额（分）——当前与 rmbAmount 相同，未来可扣除手续费 */
  netRmbAmount: number;
}

/**
 * 提现金额统一计算入口。
 * 全模块的金额换算（preview / apply / record 映射）必须且只能调用此函数，
 * 禁止在 controller / service / mapper 中手写 ×100 或使用裸 number 做金额推导。
 */
export function calcWithdrawalAmounts(beanAmount: number): WithdrawalAmounts {
  const rmbMoney = Money.fromBeanAmount(beanAmount);
  const rmbAmount = rmbMoney.toDbCents();
  // 当前无手续费，实到 = 应到；未来若引入手续费/个税，在此处统一扣算
  const netRmbAmount = rmbAmount;

  return { beanAmount, rmbAmount, netRmbAmount };
}

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
      deletedAt: null,
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
    const [partner, pendingCount, pendingAgg] = await Promise.all([
      prismaExecutor.storePartner.findFirst({
        where: { storeId, deletedAt: null, status: 'approved' },
        select: withdrawalPartnerSelect,
        orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
      }),
      prismaExecutor.partnerWithdrawal.count({
        where: {
          storeId,
          status: { in: PROCESSING_WITHDRAWAL_STATUSES },
        },
      }),
      // 待结算纯利豆 = 处理中(pending + approved)提现记录的 beanAmount 之和，
      // 不再依赖"总获得 - 总提现 - 余额"的恒等式（该式恒为 0，无法反映处理中金额）。
      prismaExecutor.partnerWithdrawal.aggregate({
        where: {
          storeId,
          status: { in: PROCESSING_WITHDRAWAL_STATUSES },
        },
        _sum: { beanAmount: true },
      }),
    ]);

    return this.mapWithdrawalOverview(
      partner,
      pendingCount,
      pendingAgg._sum.beanAmount ?? 0,
    );
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
    partner: WithdrawalPartnerSnapshot | null,
    pendingCount: number,
    pendingBeans: number,
  ): WithdrawalOverviewResponseDto {
    const beanBalance = partner?.beanBalance ?? 0;
    const totalWithdrawnBeans = partner?.totalWithdrawnBeans ?? 0;

    return {
      approvedPartner: buildApprovedPartnerResponse(partner),
      approvedPartners: partner ? [buildApprovedPartnerResponse(partner)!] : [],
      beanBalance,
      totalWithdrawnBeans,
      pendingBeans,
      pendingCount,
    };
  }
}
