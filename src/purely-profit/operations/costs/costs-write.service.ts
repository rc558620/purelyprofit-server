import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type CostRecord } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import { getPayrollCostDate, toCostDbCents } from './costs.domain';
import { CostsIdempotencyService } from './costs-idempotency.service';
import { buildCostRecordResponse } from './costs.mapper';
import type {
  PayrollComponentCostUpsertInput,
  PayrollCostUpsertInput,
  SyncPayrollCostInput,
  SyncPurchaseCostInput,
} from './costs.types';
import type { CreateCostRecordDto } from './dto/costs-query.dto';
import type { CostRecordResponseDto } from './dto/costs-response.dto';

/** 新增成本的可选入参：`idempotencyKey` 来自 `Idempotency-Key` 请求头 */
export interface CreateCostRecordOptions {
  idempotencyKey?: string;
}

@Injectable()
export class CostsWriteService {
  private readonly logger = new Logger(CostsWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly costsIdempotencyService: CostsIdempotencyService,
  ) {}

  async createRecord(
    user: AuthenticatedUser,
    dto: CreateCostRecordDto,
    options: CreateCostRecordOptions = {},
  ): Promise<CostRecordResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'cost:create',
      '无权新增成本记录',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('成本名称不能为空');
    }
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('成本金额必须大于 0');
    }

    const recordDate = new Date(dto.date);
    // 业务时区为上海：允许填写「上海今天」的任意时刻，
    // 否则比上海早进入新一天的客户端（如 UTC+9）会被误判为未来日期而 400。
    const shanghaiTodayEnd = getShanghaiDayStartMs(Date.now()) + 86_400_000 - 1;
    if (recordDate.getTime() > shanghaiTodayEnd) {
      throw new BadRequestException('成本发生日期不能晚于今天');
    }

    const idempotencyKey = this.costsIdempotencyService.normalizeKey(
      options.idempotencyKey,
    );
    const requestHash = idempotencyKey
      ? this.costsIdempotencyService.hashRequest({ storeId, dto })
      : null;

    // 先查重：命中已成功的记录时直接回放，不再落库
    if (idempotencyKey && requestHash) {
      const replayed = await this.findIdempotentReplay(
        user.id,
        idempotencyKey,
        requestHash,
      );
      if (replayed) {
        return replayed;
      }
    }

    let placeholderId: number | null = null;
    if (idempotencyKey && requestHash) {
      const claimed = await this.claimIdempotentCreate(
        user.id,
        idempotencyKey,
        requestHash,
      );
      if ('replay' in claimed) {
        return claimed.replay;
      }
      placeholderId = claimed.placeholderId;
    }

    let created: CostRecord;
    try {
      created = await this.prisma.costRecord.create({
        data: {
          storeId,
          operatorStaffId,
          sourceType: 'manual',
          title,
          type: dto.type,
          category: dto.category,
          amount: toCostDbCents(dto.amount),
          note: toOptionalText(dto.note) ?? null,
          date: recordDate,
        },
      });
    } catch (error) {
      // 落库失败：清掉占位，同一个 key 才能重试成功
      if (placeholderId !== null) {
        await this.costsIdempotencyService.discard(placeholderId);
      }
      throw error;
    }

    const response = buildCostRecordResponse(created);

    if (placeholderId !== null) {
      await this.costsIdempotencyService.finalize(placeholderId, response);
    }

    // 缓存失效只是「让派生缓存尽快过期」，不是记账成功的前提。
    // 失效失败必须降级为日志：此前它抛错会让已落库的支出被客户端判定为失败，
    // 用户重试就会重复记账。
    await this.invalidateDashboardCaches(storeId, '新增成本后');

    return response;
  }

  /** 幂等键已存在 → 回放首次响应；null 表示这是一次新请求 */
  private async findIdempotentReplay(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CostRecordResponseDto | null> {
    const existing = await this.costsIdempotencyService.find(
      actorId,
      idempotencyKey,
    );
    if (!existing) {
      return null;
    }
    this.costsIdempotencyService.ensureSameRequest(existing, requestHash);
    return this.costsIdempotencyService.resolveReplay(existing);
  }

  /**
   * 抢占幂等键；并发双击撞唯一键时回读记录：
   * 首个请求已成功 → 回放它的成本记录；仍在写入中 → resolveReplay 抛 409。
   */
  private async claimIdempotentCreate(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ placeholderId: number } | { replay: CostRecordResponseDto }> {
    try {
      const placeholderId = await this.costsIdempotencyService.claim(
        actorId,
        idempotencyKey,
        requestHash,
      );
      return { placeholderId };
    } catch (error) {
      if (!this.costsIdempotencyService.isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await this.costsIdempotencyService.find(
        actorId,
        idempotencyKey,
      );
      if (!raced) {
        throw error;
      }
      this.costsIdempotencyService.ensureSameRequest(raced, requestHash);
      return { replay: this.costsIdempotencyService.resolveReplay(raced) };
    }
  }

  async deleteRecord(user: AuthenticatedUser, recordId: number): Promise<void> {
    const record = await this.prisma.costRecord.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        storeId: true,
        sourceType: true,
      },
    });

    if (!record) {
      throw new NotFoundException('成本记录不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      record.storeId,
      'cost:delete',
      '无权删除该成本记录',
    );

    if (record.sourceType !== 'manual') {
      throw new BadRequestException('自动沉淀的成本记录不支持手动删除');
    }

    await this.prisma.costRecord.delete({ where: { id: record.id } });
    await this.invalidateDashboardCaches(record.storeId, '删除成本后');
  }

  /**
   * 成本派生缓存失效。
   *
   * 逐项兜底：任何一个 keyspace 扫描失败都只记 warn，不再向上冒泡。
   * 删除/新增本身已经成功，此时让接口报错会诱导用户重试（重复记账），
   * 而残留缓存最长只影响一个 TTL，下一轮刷新即可自愈。
   */
  private async invalidateDashboardCaches(
    storeId: number,
    stage: string,
  ): Promise<void> {
    const tasks: Array<[string, () => Promise<unknown>]> = [
      [
        '利润看板首页',
        () =>
          this.cacheInvalidatorService.invalidateProfitDashboardHome(storeId),
      ],
      [
        '经营分析',
        () =>
          this.cacheInvalidatorService.invalidatePulseDashboardOverview(
            storeId,
          ),
      ],
      [
        '成本缓存',
        () => this.cacheInvalidatorService.invalidateCostsCaches(storeId),
      ],
      // 经营分析（business-analysis）同样聚合 cost_records 计算总成本/净利润/
      // 成本结构与日趋势成本，成本写入后必须同步失效，否则最长要等一个 TTL
      // 才能在经营分析里看到新成本。
      [
        '经营分析成本',
        () => this.cacheInvalidatorService.invalidateBusinessAnalysis(storeId),
      ],
    ];

    await Promise.all(
      tasks.map(async ([name, run]) => {
        try {
          await run();
        } catch (error) {
          this.logger.warn(
            `${stage}失效${name}缓存失败 storeId=${storeId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }

  /**
   * 公开的成本缓存失效入口，供采购/工资等跨模块同步写入后调用，
   * 确保成本仪表盘/统计/报表/列表缓存与手动新增/删除保持一致的失效范围。
   *
   * 失败只记日志：跨模块的写入（采购单、工资确认）已经提交，
   * 不能因为成本侧的缓存清理失败而把整个业务动作回显成失败。
   */
  async invalidateCostCaches(storeId: number): Promise<void> {
    await this.invalidateDashboardCaches(storeId, '跨模块同步成本后');
  }

  async deletePurchaseCostRecord(
    transaction: Prisma.TransactionClient,
    storeId: number,
    purchaseOrderId: number,
  ): Promise<void> {
    await transaction.costRecord.deleteMany({
      where: {
        storeId,
        sourceType: 'purchase',
        purchaseOrderId,
      },
    });
  }

  async syncPurchaseCost(
    transaction: Prisma.TransactionClient,
    input: SyncPurchaseCostInput,
  ): Promise<CostRecord> {
    // @@unique 已改为 Partial Unique Index（原生 SQL），Prisma 不识别，
    // 需要先 findFirst 再 update/create 实现 upsert 语义
    const existing = await transaction.costRecord.findFirst({
      where: {
        storeId: input.storeId,
        sourceType: 'purchase',
        purchaseOrderId: input.purchaseOrderId,
      },
    });

    if (existing) {
      return transaction.costRecord.update({
        where: { id: existing.id },
        data: {
          operatorStaffId: input.operatorStaffId,
          title: input.title,
          amount: toCostDbCents(input.amount),
          note: toOptionalText(input.note) ?? null,
          date: input.date,
        },
      });
    }

    try {
      return await transaction.costRecord.create({
        data: {
          storeId: input.storeId,
          operatorStaffId: input.operatorStaffId,
          purchaseOrderId: input.purchaseOrderId,
          sourceType: 'purchase',
          title: input.title,
          type: 'variable',
          category: 'purchase',
          amount: toCostDbCents(input.amount),
          note: toOptionalText(input.note) ?? null,
          date: input.date,
        },
      });
    } catch (error: unknown) {
      // B7-fix: 并发 create 触发 partial unique index 冲突时，降级为 update
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const retryExisting = await transaction.costRecord.findFirst({
          where: {
            storeId: input.storeId,
            sourceType: 'purchase',
            purchaseOrderId: input.purchaseOrderId,
          },
        });
        if (retryExisting) {
          return transaction.costRecord.update({
            where: { id: retryExisting.id },
            data: {
              operatorStaffId: input.operatorStaffId,
              title: input.title,
              amount: toCostDbCents(input.amount),
              note: toOptionalText(input.note) ?? null,
              date: input.date,
            },
          });
        }
      }
      throw error;
    }
  }

  async syncPayrollCosts(
    transaction: Prisma.TransactionClient,
    input: SyncPayrollCostInput,
  ): Promise<void> {
    if (!input.actualSalary || input.actualSalary <= 0) {
      await transaction.costRecord.deleteMany({
        where: {
          storeId: input.storeId,
          payrollId: input.payrollId,
          sourceType: 'payroll_salary',
        },
      });
    } else {
      await this.upsertPayrollCostRecord(transaction, {
        storeId: input.storeId,
        payrollId: input.payrollId,
        operatorStaffId: input.operatorStaffId,
        sourceType: 'payroll_salary',
        title: `${input.employeeName}${input.month}工资`,
        type: 'fixed',
        category: 'salary',
        amount: input.actualSalary,
        note: input.note,
        month: input.month,
      });
    }

    await this.upsertPayrollComponentCostRecord(transaction, {
      storeId: input.storeId,
      payrollId: input.payrollId,
      operatorStaffId: input.operatorStaffId,
      sourceType: 'payroll_insurance',
      title: `${input.employeeName}${input.month}社保`,
      category: 'insurance',
      amount: input.socialInsurance,
      month: input.month,
    });

    await this.upsertPayrollComponentCostRecord(transaction, {
      storeId: input.storeId,
      payrollId: input.payrollId,
      operatorStaffId: input.operatorStaffId,
      sourceType: 'payroll_provident_fund',
      title: `${input.employeeName}${input.month}公积金`,
      category: 'provident_fund',
      amount: input.housingFund,
      month: input.month,
    });
  }

  private async upsertPayrollComponentCostRecord(
    transaction: Prisma.TransactionClient,
    input: PayrollComponentCostUpsertInput,
  ): Promise<void> {
    if (input.amount === undefined || input.amount <= 0) {
      await transaction.costRecord.deleteMany({
        where: {
          storeId: input.storeId,
          payrollId: input.payrollId,
          sourceType: input.sourceType,
        },
      });
      return;
    }

    await this.upsertPayrollCostRecord(transaction, {
      storeId: input.storeId,
      payrollId: input.payrollId,
      operatorStaffId: input.operatorStaffId,
      sourceType: input.sourceType,
      title: input.title,
      type: 'fixed',
      category: input.category,
      amount: input.amount,
      month: input.month,
    });
  }

  private async upsertPayrollCostRecord(
    transaction: Prisma.TransactionClient,
    input: PayrollCostUpsertInput,
  ): Promise<CostRecord> {
    // @@unique 已改为 Partial Unique Index（原生 SQL），Prisma 不识别，
    // 需要先 findFirst 再 update/create 实现 upsert 语义
    const existing = await transaction.costRecord.findFirst({
      where: {
        storeId: input.storeId,
        sourceType: input.sourceType,
        payrollId: input.payrollId,
      },
    });

    if (existing) {
      return transaction.costRecord.update({
        where: { id: existing.id },
        data: {
          operatorStaffId: input.operatorStaffId,
          title: input.title,
          type: input.type,
          category: input.category,
          amount: toCostDbCents(input.amount),
          note: toOptionalText(input.note) ?? null,
          date: getPayrollCostDate(input.month),
        },
      });
    }

    try {
      return await transaction.costRecord.create({
        data: {
          storeId: input.storeId,
          operatorStaffId: input.operatorStaffId,
          payrollId: input.payrollId,
          sourceType: input.sourceType,
          title: input.title,
          type: input.type,
          category: input.category,
          amount: toCostDbCents(input.amount),
          note: toOptionalText(input.note) ?? null,
          date: getPayrollCostDate(input.month),
        },
      });
    } catch (error: unknown) {
      // B7-fix: 并发 create 触发 partial unique index 冲突时，降级为 update
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const retryExisting = await transaction.costRecord.findFirst({
          where: {
            storeId: input.storeId,
            sourceType: input.sourceType,
            payrollId: input.payrollId,
          },
        });
        if (retryExisting) {
          return transaction.costRecord.update({
            where: { id: retryExisting.id },
            data: {
              operatorStaffId: input.operatorStaffId,
              title: input.title,
              type: input.type,
              category: input.category,
              amount: toCostDbCents(input.amount),
              note: toOptionalText(input.note) ?? null,
              date: getPayrollCostDate(input.month),
            },
          });
        }
      }
      throw error;
    }
  }
}
