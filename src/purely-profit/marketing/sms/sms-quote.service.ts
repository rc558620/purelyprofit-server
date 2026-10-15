import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Money } from '../../../shared/money.utils';
import { RedisService } from '../../../redis/redis.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsAccountService } from './sms-account.service';
import { SMS_QUOTE_TTL_SECONDS } from './sms.constants';
import type { CreateSmsQuoteDto, SmsQuoteResponseDto } from './dto/sms.dto';
import type { SmsQuoteSnapshot, SmsResolvedRecipient } from './sms.types';
import type { SmsSegmentCountMode } from './sms.constants';
import {
  buildSmsQuoteCacheKey,
  buildSmsQuoteId,
  buildSmsBroadcastId,
  calcSmsSegments,
  normalizeSmsMobile,
  resolveSmsSegmentCountMode,
  resolveSmsSegmentLimits,
} from './sms.utils';

/**
 * 群发询价服务。
 *
 * 语义（**与前端 mock 完全一致，错了金额就差 N 倍**）：
 * - `smsSegments` = 每人分段数 × 有效收件人数（**总条数**，不是每人分段数）
 * - `estimatedAmountFen` = smsSegments × unitPriceFen
 * - `validMobileCount` 只算有合法手机号的收件人，无手机号者被静默剔除
 */
@Injectable()
export class SmsQuoteService {
  private readonly logger = new Logger(SmsQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly accountService: SmsAccountService,
  ) {}

  async createQuote(
    storeId: number,
    dto: CreateSmsQuoteDto,
  ): Promise<SmsQuoteResponseDto> {
    const customerIds = this.parseCustomerIds(dto.customerIds);
    const resolved = await this.resolveRecipients(storeId, customerIds);

    if (resolved.recipients.length === 0) {
      throw new BadRequestException('所选收件人均无有效手机号，请重新选择');
    }

    const unitPriceFen = this.accountService.resolveUnitPriceFen();
    const limits = resolveSmsSegmentLimits(this.configService);
    // 口径必须与扣费侧完全一致，否则会出现「询价 100 条、扣款 120 条」的金额漂移
    const segmentMode = resolveSmsSegmentCountMode(this.configService);

    return this.buildQuote({
      storeId,
      recipientCount: customerIds.length,
      customerIds,
      recipients: resolved.recipients,
      content: dto.content,
      unitPriceFen,
      smsSegments: calcSmsSegments(
        dto.content,
        resolved.recipients.length,
        limits,
        segmentMode,
      ),
      // 固化进快照：发送时沿用同一个口径，避免切换配置瞬间出现价格漂移
      segmentMode,
    });
  }

  /** 仅供 SmsBroadcastService 复用：按顾客 ID 解析出有效收件人 */
  async resolveRecipients(
    storeId: number,
    customerIds: number[],
  ): Promise<{ recipients: SmsResolvedRecipient[]; missingCount: number }> {
    const rows = await this.prisma.marketingCustomer.findMany({
      where: { id: { in: customerIds }, storeId, deletedAt: null },
      select: { id: true, phone: true },
    });

    if (rows.length !== customerIds.length) {
      throw new BadRequestException(
        '部分收件人不存在或不属于当前门店，请刷新列表后重试',
      );
    }

    const recipients: SmsResolvedRecipient[] = [];
    const seenPhones = new Set<string>();
    let missingCount = 0;
    let duplicateCount = 0;
    for (const row of rows) {
      const mobile = normalizeSmsMobile(row.phone);
      if (!mobile) {
        missingCount += 1;
        continue;
      }
      // 同一手机号只保留第一个顾客：重复号码会被通道整批拒绝，
      // 而且一个号码只会收到一条短信，按两个收件人计费等于多收钱。
      if (seenPhones.has(mobile)) {
        duplicateCount += 1;
        continue;
      }
      seenPhones.add(mobile);
      recipients.push({ customerId: row.id, phone: mobile });
    }

    if (duplicateCount > 0) {
      this.logger.log(
        `群发收件人去重：storeId=${storeId}，剔除重复号码 ${duplicateCount} 个`,
      );
    }

    return { recipients, missingCount };
  }

  /** 读取未过期的询价快照；失效返回 null */
  async loadQuote(quoteId: string): Promise<SmsQuoteSnapshot | null> {
    const raw = await this.redis.get(buildSmsQuoteCacheKey(quoteId));
    if (!raw) {
      return null;
    }

    try {
      const snapshot = JSON.parse(raw) as SmsQuoteSnapshot;
      if (snapshot.expiresAtMs <= Date.now()) {
        return null;
      }
      return snapshot;
    } catch {
      this.logger.warn(`询价快照解析失败，quoteId=${quoteId}`);
      return null;
    }
  }

  /** customerIds 是 string[]（前端 Map 的 key），这里统一转 Int */
  parseCustomerIds(rawIds: string[]): number[] {
    const parsed: number[] = [];
    for (const rawId of rawIds) {
      const id = Number.parseInt(String(rawId).trim(), 10);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new BadRequestException(`收件人 ID 非法：${rawId}`);
      }
      if (!parsed.includes(id)) {
        parsed.push(id);
      }
    }
    return parsed;
  }

  private async buildQuote(params: {
    storeId: number;
    recipientCount: number;
    /** 全部提交的顾客 ID（含无手机号者） */
    customerIds: number[];
    recipients: SmsResolvedRecipient[];
    content: string;
    unitPriceFen: number;
    smsSegments: number;
    /** 本次询价使用的字数统计口径，固化进快照供发送时复用 */
    segmentMode: SmsSegmentCountMode;
  }): Promise<SmsQuoteResponseDto> {
    const estimated = Money.fromDbCents(params.unitPriceFen).multiply(
      params.smsSegments,
    );
    const account = await this.accountService.getAccount(params.storeId);
    const balance = Money.fromDbCents(account.balanceFen);
    const shortage = estimated.greaterThan(balance)
      ? estimated.subtract(balance)
      : Money.zero();

    const now = Date.now();
    const expiresAtMs = now + SMS_QUOTE_TTL_SECONDS * 1000;
    const quoteId = buildSmsQuoteId();

    const snapshot: SmsQuoteSnapshot = {
      quoteId,
      storeId: params.storeId,
      recipientCount: params.recipientCount,
      validMobileCount: params.recipients.length,
      smsSegments: params.smsSegments,
      segmentMode: params.segmentMode,
      unitPriceFen: params.unitPriceFen,
      estimatedAmountFen: estimated.toDbCents(),
      content: params.content,
      customerIds: params.customerIds,
      expiresAtMs,
    };

    await this.redis.set(
      buildSmsQuoteCacheKey(quoteId),
      JSON.stringify(snapshot),
      SMS_QUOTE_TTL_SECONDS,
    );

    return {
      quoteId,
      recipientCount: params.recipientCount,
      validMobileCount: params.recipients.length,
      smsSegments: params.smsSegments,
      unitPriceFen: params.unitPriceFen,
      estimatedAmountFen: estimated.toDbCents(),
      balanceFen: account.balanceFen,
      sufficient: shortage.isZero(),
      shortageFen: shortage.toDbCents(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /** 生成对外业务 ID（群发任务复用同一套 ID 生成规则） */
  buildBroadcastId(): string {
    return buildSmsBroadcastId();
  }
}
