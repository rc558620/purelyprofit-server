import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ApplyWithdrawalResponseDto } from '../../purely-profit/member/withdrawals/dto/withdrawal-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildPulseGrowthEarningsLogsCacheKey,
  buildPulseGrowthEarningsOverviewCacheKey,
} from '../pulse.cache-keys';
import { RedisService } from '../../redis/redis.service';
import {
  PULSE_EARNINGS_LOG_DEFAULT_LIMIT,
  type GetPulseEarningsLogsQueryDto,
  type PulseEarningsLogTypeValue,
  type PulseEarningsLogsResponseDto,
  type PulseEarningsOverviewResponseDto,
  type PulseWithdrawalAccountResponseDto,
} from './dto/pulse-growth-earnings.dto';
import type { UpdatePulseWithdrawalAccountDto } from './dto/pulse-growth-withdrawals.dto';
import { PulseGrowthAccessService } from './growth-access.service';
import {
  buildEarningsLogsResponse,
  buildEarningsOverviewResponse,
  buildWithdrawalAccountResponse,
  parseEarningsLogsCursor,
} from './growth-earnings.domain';
import {
  queryEarningsOverviewData,
  queryPartnerBeanLogs,
  queryWithdrawalAccountPartner,
} from './growth-earnings.query';

const PULSE_GROWTH_EARNINGS_CACHE_TTL_SECONDS = 20;
/** 非分页兼容模式下的默认查询上限，防止全量加载 */
const PULSE_EARNINGS_COMPAT_DEFAULT_LIMIT = 200;

@Injectable()
export class PulseGrowthEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accessService: PulseGrowthAccessService,
  ) {}

  async getEarningsOverview(
    user: AuthenticatedUser,
  ): Promise<PulseEarningsOverviewResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user);
    const cacheKey = buildPulseGrowthEarningsOverviewCacheKey(store.id);
    const cachedResponse =
      await this.redisService.getJson<PulseEarningsOverviewResponseDto>(
        cacheKey,
      );
    if (cachedResponse !== null) {
      return cachedResponse;
    }

    const overviewData = await queryEarningsOverviewData(this.prisma, store.id);
    const response = buildEarningsOverviewResponse(overviewData);
    await this.redisService.setJson(
      cacheKey,
      response,
      PULSE_GROWTH_EARNINGS_CACHE_TTL_SECONDS,
    );

    return response;
  }

  async getEarningsLogs(
    user: AuthenticatedUser,
    query: GetPulseEarningsLogsQueryDto = {},
  ): Promise<PulseEarningsLogsResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user);
    const typeFilter = query.type ?? 'all';
    const cursorPagination = this.resolveLogsCursorPagination(query);
    if (!cursorPagination.enabled) {
      return this.getCachedEarningsLogs(store.id, store.ownerName, typeFilter);
    }

    const [overviewData, logs] = await Promise.all([
      queryEarningsOverviewData(this.prisma, store.id),
      queryPartnerBeanLogs(this.prisma, {
        storeId: store.id,
        typeFilter,
        cursor: cursorPagination.cursor,
        limit: cursorPagination.limit,
      }),
    ]);

    return buildEarningsLogsResponse({
      partner: overviewData.partner,
      logs,
      ownerName: store.ownerName,
      limit: cursorPagination.limit,
    });
  }

  private async getCachedEarningsLogs(
    storeId: number,
    ownerName: string | null,
    typeFilter: PulseEarningsLogTypeValue,
  ): Promise<PulseEarningsLogsResponseDto> {
    const cacheKey = buildPulseGrowthEarningsLogsCacheKey(storeId, typeFilter);
    const cachedResponse =
      await this.redisService.getJson<PulseEarningsLogsResponseDto>(cacheKey);
    if (cachedResponse !== null) {
      return cachedResponse;
    }

    const [overviewData, logs] = await Promise.all([
      queryEarningsOverviewData(this.prisma, storeId),
      queryPartnerBeanLogs(this.prisma, {
        storeId,
        typeFilter,
        limit: PULSE_EARNINGS_COMPAT_DEFAULT_LIMIT,
      }),
    ]);
    const response = buildEarningsLogsResponse({
      partner: overviewData.partner,
      logs,
      ownerName,
      limit: PULSE_EARNINGS_COMPAT_DEFAULT_LIMIT,
    });
    await this.redisService.setJson(
      cacheKey,
      response,
      PULSE_GROWTH_EARNINGS_CACHE_TTL_SECONDS,
    );

    return response;
  }

  private resolveLogsCursorPagination(query: GetPulseEarningsLogsQueryDto): {
    enabled: boolean;
    cursor?: { createdAt: Date; id: number };
    limit?: number;
  } {
    if (query.cursor === undefined && query.limit === undefined) {
      return { enabled: false };
    }

    if (query.cursor === undefined) {
      return {
        enabled: true,
        limit: query.limit ?? PULSE_EARNINGS_LOG_DEFAULT_LIMIT,
      };
    }

    const cursor = parseEarningsLogsCursor(query.cursor);
    if (!cursor) {
      throw new BadRequestException('cursor 格式不合法');
    }

    return {
      enabled: true,
      cursor,
      limit: query.limit ?? PULSE_EARNINGS_LOG_DEFAULT_LIMIT,
    };
  }

  async getWithdrawalAccount(
    user: AuthenticatedUser,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user);
    const partner = await queryWithdrawalAccountPartner(this.prisma, store.id);

    return buildWithdrawalAccountResponse(partner);
  }

  async updateWithdrawalAccount(
    user: AuthenticatedUser,
    dto: UpdatePulseWithdrawalAccountDto,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    void dto;
    await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法操作提现账户',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家修改提现账户',
    );
  }

  async applyWithdrawal(
    user: AuthenticatedUser,
    beanAmount: number,
    partnerId?: string,
  ): Promise<ApplyWithdrawalResponseDto> {
    void beanAmount;
    void partnerId;
    await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法发起提现申请',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家发起提现申请',
    );
  }
}
