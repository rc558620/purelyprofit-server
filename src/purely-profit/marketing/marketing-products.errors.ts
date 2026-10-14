// ─── 营销产品写操作的 Prisma 错误 → 友好 HTTP 异常（纯函数，无副作用）────

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 新增/编辑产品的写冲突兜底：唯一约束（同门店同名，含改名撞名）与分类外键失败，
 * 统一返回 400 友好提示而非 500。
 */
export function throwOnProductWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new BadRequestException('该门店下已存在同名产品');
    }
    if (error.code === 'P2003') {
      throw new BadRequestException('产品分类不存在或不属于当前门店');
    }
  }
  throw error;
}

/** B-5 fix：删除产品被外键引用时返回友好提示而非 500 */
export function throwOnProductDeleteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2014' || error.code === 'P2003')
  ) {
    throw new BadRequestException('该产品已被其他业务引用，无法删除');
  }
  throw error;
}
