// 商家端持卡写业务：手动增减次数
// 写卡 + 写流水必须在同一事务内完成，读操作见 member-cards.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { MemberCard } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MarketingSharedService } from '../../marketing/marketing-shared.service';
import type { AdjustMemberCardTimesDto } from './dto/adjust-member-card-times.dto';
import type { MemberCardDto } from './dto/member-card.response.dto';
import { applyTimesAdjustment } from './member-card-adjust.writer';
import {
  MEMBER_CARD_ADJUSTABLE_STATUS_VALUES,
  MEMBER_CARD_TIMES_KIND,
} from './member-card.constants';
import { MemberCardsService } from './member-cards.service';

/** 调次的操作人快照：员工身份优先，实操人员缺失时留空而不是伪造账号 ID */
interface CardOperator {
  staffId: number | null;
  name: string | null;
}

/** Prisma 唯一约束冲突（调次幂等键撞键） */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * 持卡写操作编排层。
 *
 * - 归属：写操作以卡自身归属门店为准并先过 member-card:manage 校验；
 * - 事务：调次落「卡次数 + 状态 + 流水」，任一失败整体回滚，禁止只写卡不写流水；
 * - 并发：调次走条件 updateMany，用影响行数裁决。
 */
@Injectable()
export class MemberCardsWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly memberCardsService: MemberCardsService,
  ) {}

  async adjustTimes(
    user: AuthenticatedUser,
    cardId: number,
    dto: AdjustMemberCardTimesDto,
  ): Promise<MemberCardDto> {
    const card = await this.memberCardsService.getCardOrThrow(cardId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      card.storeId,
      'member-card:manage',
    );
    this.assertTimesAdjustable(card);

    const operator = this.resolveOperator(user);
    const requestId = dto.requestId?.trim() ? dto.requestId.trim() : null;

    try {
      await this.prisma.$transaction((tx) =>
        applyTimesAdjustment(tx, {
          card,
          delta: dto.delta,
          remark: dto.remark.trim(),
          operatorStaffId: operator.staffId,
          operatorName: operator.name,
          requestId,
        }),
      );
    } catch (error) {
      /*
       * 幂等命中：同一 requestId 的上一笔已成功落库（写成功但响应丢失后重试），
       * 本次事务整体回滚，直接返回当前卡，禁止重复加减次数。
       * 调次事务内唯一的唯一约束是 (cardId, requestId)，P2002 只会来自这里。
       */
      if (requestId !== null && isUniqueViolation(error)) {
        return this.memberCardsService.buildCardDtoById(card.id);
      }
      throw error;
    }

    return this.memberCardsService.buildCardDtoById(card.id);
  }

  private assertTimesAdjustable(card: MemberCard): void {
    if (card.kind !== MEMBER_CARD_TIMES_KIND) {
      throw new BadRequestException('时长卡不支持调整次数');
    }
    if (!MEMBER_CARD_ADJUSTABLE_STATUS_VALUES.includes(card.status)) {
      throw new ConflictException('当前会员卡状态不允许调整次数');
    }
    if (card.remainTimes === null) {
      throw new ConflictException('会员卡剩余次数缺失，请先核对卡片数据');
    }
  }

  private resolveOperator(user: AuthenticatedUser): CardOperator {
    const name = user.name?.trim();

    return {
      staffId: user.currentMembership?.staffId ?? null,
      name: name ? name : null,
    };
  }
}
