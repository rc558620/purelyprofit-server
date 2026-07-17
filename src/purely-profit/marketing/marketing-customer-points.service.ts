import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import type { AdjustCustomerPointsDto } from './dto/marketing-query.dto';
import type { MarketingCustomerDto } from './dto/marketing-response.dto';
import { mapCustomerRow } from './marketing.mapper';
import type { MarketingCustomerRow } from './marketing.types';
import {
  buildMarketingCustomersListPattern,
  buildMarketingCustomerDetailPattern,
} from '../../redis/cache-keys';

@Injectable()
export class MarketingCustomerPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async adjustCustomerPoints(
    customer: MarketingCustomerRow,
    customerId: number,
    dto: AdjustCustomerPointsDto,
  ): Promise<MarketingCustomerDto> {
    // D2: 幂等保护，5 秒内同参数请求视为重复提交
    const idempotencyKey = `adjust-points:dedup:${customer.storeId}:${customerId}:${dto.delta}:${dto.remark?.trim() || ''}`;
    const isNew = await this.redisService.setIfAbsent(idempotencyKey, '1', 5);
    if (!isNew) {
      throw new BadRequestException('请勿重复提交，请稍后再试');
    }

    if (dto.delta < 0 && Math.abs(dto.delta) > customer.points) {
      throw new BadRequestException(
        `扣除积分不能超过当前余额（${customer.points}）`,
      );
    }

    const absDelta = Math.abs(dto.delta);
    const isDeduct = dto.delta < 0;

    const updated = await this.prisma.$transaction(
      async (tx) => {
        let marketingUpdated;
        if (isDeduct) {
          const result = await tx.marketingCustomer.updateMany({
            where: { id: customerId, points: { gte: absDelta } },
            data: { points: { decrement: absDelta } },
          });
          if (result.count === 0) {
            throw new BadRequestException(
              '积分余额不足，扣除失败；请刷新后重试',
            );
          }
          marketingUpdated = await tx.marketingCustomer.findUniqueOrThrow({
            where: { id: customerId },
          });
        } else {
          marketingUpdated = await tx.marketingCustomer.update({
            where: { id: customerId },
            data: { points: { increment: dto.delta } },
          });
        }

        // 创建营销积分流水记录
        await tx.marketingPointsRecord.create({
          data: {
            storeId: customer.storeId,
            customerId,
            amount: dto.delta,
            type: dto.delta > 0 ? 'gift' : 'spend',
            description:
              dto.remark || (dto.delta > 0 ? '后台调整积分' : '后台扣除积分'),
          },
        });

        // 若有关联 Member，同步写 MemberPointsLog 流水（审计留档）
        if (customer.memberId !== null) {
          const beforePoints = marketingUpdated.points - dto.delta;
          await tx.memberPointsLog.create({
            data: {
              memberId: customer.memberId,
              storeId: customer.storeId,
              changeType: dto.delta > 0 ? 'increase' : 'decrease',
              source: 'admin_adjust',
              changeAmount: absDelta,
              beforePoints,
              afterPoints: marketingUpdated.points,
              reason: '后台管理员调整',
              remark: dto.remark || null,
            },
          });
        }

        return marketingUpdated;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    await this.invalidateCache(customer.storeId);

    return mapCustomerRow(updated);
  }

  private async invalidateCache(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      this.redisService.delByPattern(
        buildMarketingCustomersListPattern(storeId),
      ),
      this.redisService.delByPattern(
        buildMarketingCustomerDetailPattern(storeId),
      ),
    ]);
  }
}
