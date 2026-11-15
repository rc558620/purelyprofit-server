/**
 * 充值下单的「套餐 / 自定义金额」选择解析。
 *
 * 抽成纯函数模块的理由：这段逻辑只做入参互斥校验、套餐匹配与金额归一，
 * 不碰 Prisma / Redis / 微信，与下单编排（幂等占位、草稿、预下单）是两类职责。
 * 留在编排服务里会让该文件顶到 400 行红线（规范 §十），也不利于单独回归。
 *
 * 口径零变化：抛出异常的类型、业务码与中文文案与原实现逐条一致。
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  clubRechargeError,
  CLUB_RECHARGE_ERROR_CODE,
} from './club-recharge.errors';
import {
  CLUB_CUSTOM_AMOUNT_MAX,
  CLUB_CUSTOM_AMOUNT_MIN,
  CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE,
} from './club-recharge.constants';
import type {
  ClubRechargePackageDto,
  CreateClubRechargeOrderDto,
} from './dto/club-recharge.dto';
import type { ResolvedRechargeOrderSelection } from './club-recharge.types';
import { Money } from './club-recharge.utils';

/** 解析本次充值选择：`packageId` 与 `customAmount` 必须且只能传一个 */
export function resolveRechargeOrderSelection(
  dto: CreateClubRechargeOrderDto,
  packages: ClubRechargePackageDto[],
): ResolvedRechargeOrderSelection {
  const hasPackageId =
    typeof dto.packageId === 'string' && dto.packageId.trim().length > 0;
  const hasCustomAmount = typeof dto.customAmount === 'number';

  if (hasPackageId === hasCustomAmount) {
    throw new BadRequestException(
      clubRechargeError(
        CLUB_RECHARGE_ERROR_CODE.PARAM_PACKAGE_AMOUNT_EXCLUSIVE,
        'packageId 和 customAmount 必须二选一',
      ),
    );
  }

  if (hasPackageId) {
    return resolvePackageSelection(dto.packageId!, packages);
  }

  return resolveCustomAmountSelection(dto.customAmount!);
}

/** 套餐选择：金额一律按「元 → 分」统一换算，前端不能自己算分 */
function resolvePackageSelection(
  packageId: string,
  packages: ClubRechargePackageDto[],
): ResolvedRechargeOrderSelection {
  const matchedPackage = packages.find((item) => item.id === packageId);
  if (!matchedPackage) {
    throw new NotFoundException(
      clubRechargeError(
        CLUB_RECHARGE_ERROR_CODE.RESOURCE_PACKAGE_NOT_FOUND,
        CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE,
      ),
    );
  }

  return {
    packageId: matchedPackage.id,
    promotionId: resolvePromotionIdFromPackageId(matchedPackage.id),
    rechargeAmountFen: Money.fromInputYuan(matchedPackage.amount).toDbCents(),
    bonusAmountFen: Money.fromInputYuan(matchedPackage.bonusAmount).toDbCents(),
    customAmountFen: null,
  };
}

/** 自定义金额：区间校验后按「元 → 分」换算，不参与赠送 */
function resolveCustomAmountSelection(
  customAmount: number,
): ResolvedRechargeOrderSelection {
  if (
    customAmount < CLUB_CUSTOM_AMOUNT_MIN ||
    customAmount > CLUB_CUSTOM_AMOUNT_MAX
  ) {
    throw new BadRequestException(
      clubRechargeError(
        CLUB_RECHARGE_ERROR_CODE.PARAM_CUSTOM_AMOUNT_OUT_OF_RANGE,
        `自定义充值金额需在 ${CLUB_CUSTOM_AMOUNT_MIN}-${CLUB_CUSTOM_AMOUNT_MAX} 元之间`,
      ),
    );
  }

  return {
    packageId: null,
    promotionId: null,
    rechargeAmountFen: Money.fromInputYuan(customAmount).toDbCents(),
    bonusAmountFen: 0,
    customAmountFen: Money.fromInputYuan(customAmount).toDbCents(),
  };
}

/**
 * 套餐 ID → 活动 ID。
 *
 * 套餐 ID 形如 `18` 或 `18:3`（冒号后是展示用的档位后缀），活动 ID 恒为前缀数字；
 * 解析不出来视为「套餐没有绑定活动」，不阻断下单。
 */
function resolvePromotionIdFromPackageId(packageId: string): number | null {
  const matched = /^(\d+)(?::\d+)?$/.exec(packageId.trim());
  if (!matched) {
    return null;
  }

  return Number.parseInt(matched[1], 10);
}
