/**
 * 密码策略常量与校验工具
 *
 * 规则：最小 6 位，最大 18 位
 */

import { BadRequestException } from '@nestjs/common';

/** 密码最大长度 */
export const PASSWORD_MAX_LENGTH = 18;

/** 密码最小长度 */
export const PASSWORD_MIN_LENGTH = 6;

/**
 * 校验明文密码长度（在 RSA 解密后调用）
 *
 * DTO 层不应限制密码长度，因为前端可能传输 RSA 加密后的密文（约 344 字符），
 * 长度校验必须在 RSA 解密得到明文密码之后再执行。
 *
 * @param password 明文密码
 * @param label 字段中文名，用于错误提示（如 "密码"、"新密码"）
 * @throws BadRequestException 密码长度不合规时抛出异常
 */
export function validatePasswordLength(
  password: string,
  label = '密码',
): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(
      `${label}至少 ${PASSWORD_MIN_LENGTH} 位`,
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new BadRequestException(
      `${label}最多 ${PASSWORD_MAX_LENGTH} 位`,
    );
  }
}
