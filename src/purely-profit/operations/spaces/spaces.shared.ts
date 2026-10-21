import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { SpaceQrTokenKeyConfig } from '../../../shared/space-qr-token-codec.utils';

/**
 * 断言当前请求者为主账号（identityType 为 owner 或 staff），任何子账号身份
 * （收银员 / 店长 / 财务）均拒绝。
 *
 * 空间类运营配置（空间 / 空间类型 / 空间区域）的增改删属于门店级配置，
 * 仅对绑定门店的主账号开放，以保持最小权限原则。前端已通过 isPrimaryAccount
 * 隐藏入口，此处为后端兜底校验（防止直接调用接口绕过）。
 *
 * @param configLabel 配置名词，用于生成告警文案（如 '空间类型' → '子账号不可维护空间类型配置'）
 */
export function ensurePrimaryAccountOnly(
  user: AuthenticatedUser,
  configLabel: string,
): void {
  if (user.currentMembership?.subjectType === 'sub_account') {
    throw new ForbiddenException(`子账号不可维护${configLabel}配置`);
  }
}

/**
 * 读取空间码 token 加解密所需的密钥配置（当前密钥 / 上一轮密钥 / JWT 密钥）。
 *
 * 历史上 spaces-write.service 与 space-qr-code.service 各有一份相同实现，
 * 此处收敛为唯一权威，避免密钥读取口径漂移。
 */
export function readSpaceQrTokenKeyConfig(
  configService: ConfigService,
): SpaceQrTokenKeyConfig {
  return {
    current: configService.get<string>('space.qrTokenEncryptionKey'),
    previous: configService.get<string>('space.qrTokenEncryptionKeyPrevious'),
    jwtSecret: configService.get<string>('jwt.secret'),
  };
}
