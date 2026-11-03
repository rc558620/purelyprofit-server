// 卡模板写操作的 Prisma 错误 → 友好 HTTP 异常（纯函数，无副作用）
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 写冲突兜底：
 * - P2002：同门店未删除模板名唯一（改名撞名 / 并发创建），归一化为 409；
 * - P2025：记录在权限校验后被删除，归一化为 404。
 */
export function throwOnPlanWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new ConflictException('同一门店下已存在同名会员卡模板');
    }
    if (error.code === 'P2025') {
      throw new NotFoundException('会员卡模板不存在');
    }
  }
  throw error;
}

/**
 * 划线价只是展示锚点，低于售价会让前端呈现「越买越贵」。
 * 入参统一为分，比较在分维度完成，避免元浮点比较误差。
 */
export function assertOriginalPriceNotLessThanPrice(
  priceFen: number,
  originalPriceFen: number | null,
): void {
  if (originalPriceFen !== null && originalPriceFen < priceFen) {
    throw new BadRequestException('划线价不能低于售价');
  }
}
