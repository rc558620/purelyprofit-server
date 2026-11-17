// 扫码点餐规格的校验与「内容是否变更」判定（纯函数，无副作用）
import { BadRequestException } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import type { ProductSpecGroupDto } from './dto/product.dto';

/** 规格组入参校验：名称唯一、选项非空、选择数量与默认项合法 */
export const validateProductSpecificationGroups = (
  groups: ProductSpecGroupDto[],
): void => {
  const groupNames = new Set<string>();
  for (const group of groups) {
    const name = group.name.trim();
    if (!name) throw new BadRequestException('规格组名称不能为空');
    if (groupNames.has(name))
      throw new BadRequestException('规格组名称不能重复');
    groupNames.add(name);
    if (group.options.length === 0)
      throw new BadRequestException('每个规格组至少需要一个选项');
    if (group.selectMode === 'single' && group.maxSelect !== 1)
      throw new BadRequestException('单选规格组最多只能选择一项');
    // null 表示不限选；显式上限必须是 >=1 的合法数量。
    if (group.maxSelect !== null) {
      if (group.maxSelect < 1)
        throw new BadRequestException('最多选择数量不能小于 1');
      if (
        group.minSelect > group.maxSelect ||
        group.maxSelect > group.options.length
      )
        throw new BadRequestException('规格组选择数量不合法');
    }
    const optionNames = new Set<string>();
    const activeOptions = group.options.filter((option) => option.isActive);
    const defaults = activeOptions.filter((option) => option.isDefault);
    if (group.minSelect > activeOptions.length)
      throw new BadRequestException('启用规格选项不足以满足最少选择数量');
    if (group.selectMode === 'single' && defaults.length > 1)
      throw new BadRequestException('单选规格组最多只能设置一个默认项');
    for (const option of group.options) {
      const optionName = option.name.trim();
      if (!optionName) throw new BadRequestException('规格选项名称不能为空');
      if (optionNames.has(optionName))
        throw new BadRequestException('同一规格组的选项名称不能重复');
      optionNames.add(optionName);
    }
  }
};

/**
 * 已落库规格与待写入规格的内容是否完全一致（按排序后的位置逐项比较，不比较 ID）。
 *
 * 只比内容不比 ID，是因为新建选项的 ID 由前端生成占位值（`new-opt-x`），
 * 与库里的数字 ID 天然不同；真正需要防的是「内容没变却把 ID 重建一遍」。
 */
export const hasSameProductSpecifications = (
  current: Array<{
    name: string;
    selectionType: string;
    minSelections: number;
    maxSelections: number | null;
    sortOrder: number;
    options: Array<{
      name: string;
      extraPrice: number;
      isDefault: boolean;
      isActive: boolean;
      sortOrder: number;
    }>;
  }>,
  next: ProductSpecGroupDto[],
): boolean => {
  const sortedNext = [...next].sort((left, right) => left.sort - right.sort);
  if (current.length !== sortedNext.length) return false;

  return sortedNext.every((group, groupIndex) => {
    const currentGroup = current[groupIndex];
    if (
      currentGroup.name !== group.name.trim() ||
      currentGroup.selectionType !==
        (group.selectMode === 'multi' ? 'multiple' : 'single') ||
      currentGroup.minSelections !== group.minSelect ||
      currentGroup.maxSelections !== group.maxSelect ||
      currentGroup.sortOrder !== group.sort
    ) {
      return false;
    }

    if (currentGroup.options.length !== group.options.length) return false;
    return group.options.every((option, optionIndex) => {
      const currentOption = currentGroup.options[optionIndex];
      return (
        currentOption.name === option.name.trim() &&
        currentOption.extraPrice ===
          Money.fromInputYuan(option.priceDelta).toDbCents() &&
        currentOption.isDefault === option.isDefault &&
        currentOption.isActive === option.isActive &&
        currentOption.sortOrder === optionIndex
      );
    });
  });
};
