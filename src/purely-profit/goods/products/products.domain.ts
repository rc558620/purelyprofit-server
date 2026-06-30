import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import {
  createCategoryRecord,
  findCategoryDuplicateByName,
} from '../categories/categories.query';
import { findProductCodeConflict } from './products.query';
import type { ProductCategoryRecord } from './products.types';

/**
 * 根据售价与成本价推导单件利润。
 *
 * 规则：
 * - 无成本价时，利润 = 售价（未录入成本则默认全为利润）；
 * - 有成本价时，利润 = 售价 − 成本价（允许负数，即亏本商品）。
 *
 * ⚠️ 这是服务端唯一的利润推导来源，前端传入的 profit 字段仅作兼容/预览，
 *    服务端一律忽略，以此杜绝金额篡改风险。
 */
export function deriveProductProfit(
  price: Money,
  costPrice?: Money | null,
): Money {
  if (costPrice === undefined || costPrice === null) {
    return price;
  }
  return price.subtract(costPrice);
}

/**
 * 校验派生后的利润是否满足业务约束。
 *
 * 当前规则：利润必须 > 0（即成本价不得大于等于售价）。
 * 若后续业务允许负利润，只需移除此函数的调用即可。
 */
export function validateDerivedProfit(profit: Money): void {
  if (!profit.isPositive()) {
    throw new BadRequestException('每单利润必须大于 0（成本价不能大于等于售价）');
  }
}

const PRODUCT_CODE_GENERATE_ATTEMPTS = 5;

function buildGeneratedProductCode(now: number, randomPart: number): string {
  return `PRD${now}${randomPart}`;
}

function defaultGenerateProductCode(): string {
  return buildGeneratedProductCode(
    Date.now(),
    Math.floor(Math.random() * 1000),
  );
}

export async function ensureProductCategory(
  prisma: PrismaService,
  params: {
    storeId: number;
    categoryName: string;
  },
): Promise<ProductCategoryRecord | null> {
  const name = params.categoryName.trim();
  if (name === '') {
    return null;
  }

  const existing = await findCategoryDuplicateByName(prisma, {
    storeId: params.storeId,
    name,
  });
  if (existing) {
    return existing;
  }

  // 并发场景下先查后建可能触发 unique constraint，捕获后重新查询
  try {
    const created = await createCategoryRecord(prisma, {
      storeId: params.storeId,
      name,
      icon: null,
    });
    return { id: created.id };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      // 并发创建导致唯一约束冲突，重新查询已存在的分类
      const concurrent = await findCategoryDuplicateByName(prisma, {
        storeId: params.storeId,
        name,
      });
      return concurrent;
    }
    throw error;
  }
}

export async function ensureUniqueProductCode(
  prisma: PrismaService,
  params: {
    storeId: number;
    code: string;
    excludeId?: number;
  },
): Promise<void> {
  const existing = await findProductCodeConflict(prisma, params);

  if (existing) {
    throw new ConflictException('商品编号已存在');
  }
}

export async function resolveProductCode(
  prisma: PrismaService,
  params: {
    storeId: number;
    code?: string;
    generateCode?: () => string;
  },
): Promise<string> {
  const normalized = params.code?.trim();
  if (normalized) {
    await ensureUniqueProductCode(prisma, {
      storeId: params.storeId,
      code: normalized,
    });
    return normalized;
  }

  const generateCode = params.generateCode ?? defaultGenerateProductCode;

  for (
    let attempt = 0;
    attempt < PRODUCT_CODE_GENERATE_ATTEMPTS;
    attempt += 1
  ) {
    const generated = generateCode();
    const existing = await findProductCodeConflict(prisma, {
      storeId: params.storeId,
      code: generated,
    });

    if (!existing) {
      return generated;
    }
  }

  throw new ConflictException('商品编号生成失败，请重试');
}
