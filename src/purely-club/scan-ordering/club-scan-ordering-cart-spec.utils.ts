import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';

/** 规格选项最小形状（Prisma specGroup.options 的结构子集）。 */
export interface CartSpecOptionSource {
  id: number;
  name: string;
  extraPrice: number;
  stockQuantity: number | null;
  reservedQuantity: number | null;
}

/** 规格组最小形状（Prisma specGroups 的结构子集）。 */
export interface CartSpecGroupSource {
  id: number;
  minSelections: number;
  maxSelections: number | null;
  options: CartSpecOptionSource[];
}

const SPEC_SELECTION_INVALID = '商品规格选择不符合要求';

/**
 * 校验本次选中的规格选项：必须真实存在，且每个组的选中数量满足 min/max 约束。
 * 返回按组顺序拍平的选中项，供单价计算与库存校验共用。
 */
export const validateSpecOptions = (
  groups: CartSpecGroupSource[],
  selectedIds: number[],
): CartSpecOptionSource[] => {
  const selected = new Set(selectedIds);
  const options = groups.flatMap((group) =>
    group.options.filter((option) => selected.has(option.id)),
  );
  if (options.length !== selected.size) throw specSelectionInvalid();
  for (const group of groups) {
    // 选中项数量：先建选中集合，再线性统计该组命中的选项数，
    // 避免 options × group.options 的嵌套扫描。
    let count = 0;
    for (const candidate of group.options) {
      if (selected.has(candidate.id)) count += 1;
    }
    if (
      count < group.minSelections ||
      (group.maxSelections !== null && count > group.maxSelections)
    ) {
      throw specSelectionInvalid();
    }
  }
  return options;
};

/**
 * 规格选项库存校验：stockQuantity 为 null 表示不限，否则
 * 可用库存 = 总库存 − 预留量，必须 >= 目标数量。
 * 与下单时 reserveFiniteSpecStock 的口径保持一致，避免「加进购物车才被告知没货」。
 */
export const assertSpecOptionsPurchasable = (
  options: CartSpecOptionSource[],
  requiredByOption: Map<number, number>,
): void => {
  for (const option of options) {
    if (option.stockQuantity === null) continue;
    const required = requiredByOption.get(option.id) ?? 0;
    const available = option.stockQuantity - (option.reservedQuantity ?? 0);
    if (available < required) {
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RULE_STOCK_INSUFFICIENT,
          `规格【${option.name}】已售罄或库存不足`,
        ),
      );
    }
  }
};

/** 把本次加购数量累加进「规格选项已占数量」，供后续库存校验使用。 */
export const accumulateSpecOptionQuantity = (
  quantities: Map<number, number>,
  options: CartSpecOptionSource[],
  quantity: number,
): Map<number, number> => {
  for (const option of options) {
    quantities.set(option.id, (quantities.get(option.id) ?? 0) + quantity);
  }
  return quantities;
};

/** 单价 = 商品基准价 + Σ 规格加价。 */
export const computeUnitPriceAmount = (
  basePrice: number,
  options: CartSpecOptionSource[],
): number =>
  basePrice + options.reduce((sum, option) => sum + option.extraPrice, 0);

/**
 * 规格组合签名：选中选项 ID 排序后取 sha256，作为购物车行的部分唯一索引列。
 * 排序保证「同一组合不同点选顺序」落到同一行。
 */
export const hashSpecSignature = (selectedIds: number[]): string =>
  createHash('sha256')
    .update([...selectedIds].sort((a, b) => a - b).join(','))
    .digest('hex');

const specSelectionInvalid = (): BadRequestException =>
  new BadRequestException(
    clubScanOrderingError(
      CLUB_SCAN_ORDERING_ERROR_CODE.PARAM_SPEC_SELECTION_INVALID,
      SPEC_SELECTION_INVALID,
    ),
  );
