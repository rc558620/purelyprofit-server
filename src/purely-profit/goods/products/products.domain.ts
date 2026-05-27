import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  createProductCategory,
  findProductCategoryByName,
  findProductCodeConflict,
} from './products.query';
import type { ProductCategoryRecord } from './products.types';

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

  const existing = await findProductCategoryByName(
    prisma,
    params.storeId,
    name,
  );
  if (existing) {
    return existing;
  }

  return createProductCategory(prisma, params.storeId, name);
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
