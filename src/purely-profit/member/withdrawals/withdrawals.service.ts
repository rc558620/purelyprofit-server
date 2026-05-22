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
  type ApplyWithdrawalDto,
  type ListWithdrawalsQueryDto,
} from './dto/apply-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/review-withdrawal.dto';
import {
  type ApplyWithdrawalResponseDto,
  type ReviewWithdrawalResponseDto,
  type WithdrawalOverviewResponseDto,
  type WithdrawalRecordResponseDto,
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

type PrismaExecutor = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WithdrawalsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(
    user: AuthenticatedUser,
  ): Promise<WithdrawalOverviewResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.buildOverview(this.prisma, storeId);
  }

  async list(
    user: AuthenticatedUser,
    query: ListWithdrawalsQueryDto,
  ): Promise<WithdrawalRecordResponseDto[]> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const records = await this.prisma.partnerWithdrawal.findMany({
      where: {
        storeId,
        ...(query.status ? { status: query.status } : {}),
      },
      select: withdrawalRecordSelect,
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
    });

    return records.map((record) => mapWithdrawalRecord(record));
  }

  async apply(
    user: AuthenticatedUser,
    dto: ApplyWithdrawalDto,
  ): Promise<ApplyWithdrawalResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    this.ensureWithdrawAmountWithinFrontEndRange(dto.beanAmount);

    const partner = await this.prisma.storePartner.findUnique({
      where: { storeId },
      select: {
        id: true,
        status: true,
        beanBalance: true,
      },
    });

    if (!partner || partner.status !== 'approved') {
      throw new ForbiddenException(
        '当前账号尚未通过合伙人审核，暂不可申请提现',
      );
    }

    if (partner.beanBalance < dto.beanAmount) {
      throw new ConflictException('纯利豆余额不足，无法发起提现申请');
    }

    const trimmedAccountNo = dto.accountNo.trim();
    const trimmedAccountName = dto.accountName.trim();

    if (trimmedAccountNo === '' || trimmedAccountName === '') {
      throw new ConflictException('收款信息不能为空');
    }

    const operatorStaffId = user.currentMembership?.staffId ?? null;

    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.storePartner.updateMany({
        where: {
          id: partner.id,
          status: 'approved',
          beanBalance: { gte: dto.beanAmount },
        },
        data: {
          beanBalance: { decrement: dto.beanAmount },
          totalWithdrawnBeans: { increment: dto.beanAmount },
          paymentAccountType: dto.accountType,
          paymentAccountNo: trimmedAccountNo,
          paymentAccountName: trimmedAccountName,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('纯利豆余额不足，无法发起提现申请');
      }

      const createdRecord = await tx.partnerWithdrawal.create({
        data: {
          storeId,
          partnerId: partner.id,
          operatorStaffId,
          beanAmount: dto.beanAmount,
          rmbAmount: dto.beanAmount * 100,
          accountType: dto.accountType,
          accountNo: trimmedAccountNo,
          accountName: trimmedAccountName,
          status: 'pending',
        },
        select: withdrawalRecordSelect,
      });

      await tx.storePartnerBeanLog.create({
        data: {
          storeId,
          partnerId: partner.id,
          source: 'withdrawal',
          changeAmount: -dto.beanAmount,
          description: `提现申请 · ¥${dto.beanAmount}`,
        },
      });

      return this.buildOperationResponse(tx, storeId, createdRecord);
    });
  }

  async approve(
    user: AuthenticatedUser,
    withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record = await this.getScopedWithdrawalOrThrow(user, withdrawalId);

    if (record.status !== PartnerWithdrawalStatus.pending) {
      throw new ConflictException('仅审核中的提现申请可执行通过操作');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updateResult = await tx.partnerWithdrawal.updateMany({
        where: {
          id: withdrawalId,
          storeId: record.storeId,
          status: PartnerWithdrawalStatus.pending,
        },
        data: {
          status: PartnerWithdrawalStatus.approved,
          reviewedAt: now,
          rejectReason: null,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('提现申请状态已变化，请刷新后重试');
      }

      const updatedRecord = await this.findWithdrawalByIdOrThrow(
        tx,
        withdrawalId,
      );
      return this.buildOperationResponse(tx, record.storeId, updatedRecord);
    });
  }

  async reject(
    user: AuthenticatedUser,
    withdrawalId: number,
    dto: RejectWithdrawalDto,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record = await this.getScopedWithdrawalOrThrow(user, withdrawalId);

    if (record.status !== PartnerWithdrawalStatus.pending) {
      throw new ConflictException('仅审核中的提现申请可执行拒绝操作');
    }

    const rejectReason = dto.reason.trim();
    if (rejectReason === '') {
      throw new ConflictException('拒绝原因不能为空');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updateResult = await tx.partnerWithdrawal.updateMany({
        where: {
          id: withdrawalId,
          storeId: record.storeId,
          status: PartnerWithdrawalStatus.pending,
        },
        data: {
          status: PartnerWithdrawalStatus.rejected,
          reviewedAt: now,
          rejectReason,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('提现申请状态已变化，请刷新后重试');
      }

      const partnerUpdateResult = await tx.storePartner.updateMany({
        where: {
          id: record.partnerId,
          storeId: record.storeId,
          totalWithdrawnBeans: { gte: record.beanAmount },
        },
        data: {
          beanBalance: { increment: record.beanAmount },
          totalWithdrawnBeans: { decrement: record.beanAmount },
        },
      });

      if (partnerUpdateResult.count !== 1) {
        throw new ConflictException('合伙人余额更新失败，请稍后重试');
      }

      await tx.storePartnerBeanLog.create({
        data: {
          storeId: record.storeId,
          partnerId: record.partnerId,
          source: 'admin_adjust',
          changeAmount: record.beanAmount,
          description: `提现退回 · ${record.beanAmount} 豆已退回`,
        },
      });

      const updatedRecord = await this.findWithdrawalByIdOrThrow(
        tx,
        withdrawalId,
      );
      return this.buildOperationResponse(tx, record.storeId, updatedRecord);
    });
  }

  async pay(
    user: AuthenticatedUser,
    withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record = await this.getScopedWithdrawalOrThrow(user, withdrawalId);

    if (record.status !== PartnerWithdrawalStatus.approved) {
      throw new ConflictException('仅已通过审核的提现申请可确认打款');
    }

    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.partnerWithdrawal.updateMany({
        where: {
          id: withdrawalId,
          storeId: record.storeId,
          status: PartnerWithdrawalStatus.approved,
        },
        data: {
          status: PartnerWithdrawalStatus.paid,
          paidAt: new Date(),
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('提现申请状态已变化，请刷新后重试');
      }

      const updatedRecord = await this.findWithdrawalByIdOrThrow(
        tx,
        withdrawalId,
      );
      return this.buildOperationResponse(tx, record.storeId, updatedRecord);
    });
  }

  private async buildOverview(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<WithdrawalOverviewResponseDto> {
    const [partner, pendingCount] = await Promise.all([
      prismaExecutor.storePartner.findUnique({
        where: { storeId },
        select: {
          status: true,
          beanBalance: true,
          totalWithdrawnBeans: true,
        },
      }),
      prismaExecutor.partnerWithdrawal.count({
        where: {
          storeId,
          status: { in: PROCESSING_WITHDRAWAL_STATUSES },
        },
      }),
    ]);

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

  private async buildOperationResponse(
    prismaExecutor: PrismaExecutor,
    storeId: number,
    record: WithdrawalRecordSnapshot,
  ): Promise<ReviewWithdrawalResponseDto> {
    return {
      record: mapWithdrawalRecord(record),
      overview: await this.buildOverview(prismaExecutor, storeId),
    };
  }

  private async getScopedWithdrawalOrThrow(
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

  private async findWithdrawalByIdOrThrow(
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

  private getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;

    if (!storeId) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }

    return storeId;
  }

  private ensureWithdrawAmountWithinFrontEndRange(beanAmount: number): void {
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
}
