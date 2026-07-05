import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../purely-profit/auth/strategies/jwt.strategy';

/**
 * IDOR (Insecure Direct Object Reference) 防护工具集
 *
 * 提供资源归属校验的标准方法，确保用户只能访问自己有权操作的资源。
 * 所有接受外部 ID 参数的写操作端点均应使用这些工具进行归属校验。
 */

/**
 * 确保用户有门店上下文（currentMembership.storeId 存在）
 *
 * @throws ForbiddenException 用户无门店权限
 */
export function ensureUserHasStore(user: AuthenticatedUser): number {
  const storeId = user.currentMembership?.storeId;
  if (!storeId) {
    throw new ForbiddenException('当前账号暂无门店权限');
  }
  return storeId;
}

/**
 * 确保用户是门店 Owner（用于高危操作如删除数据、权限变更）
 *
 * @throws ForbiddenException 用户非门店 Owner
 */
export function ensureUserIsStoreOwner(user: AuthenticatedUser): void {
  const membership = user.currentMembership;
  if (!membership || membership.role !== 'owner') {
    throw new ForbiddenException('仅门店所有者可执行此操作');
  }
}

/**
 * 确保资源归属门店与当前用户门店一致
 *
 * 用于校验 "用户传入的 storeId 是否等于自己当前门店" 的场景。
 *
 * @throws ForbiddenException 资源不属于当前门店
 */
export function ensureResourceBelongsToStore(
  user: AuthenticatedUser,
  resourceStoreId: number,
): void {
  const userStoreId = ensureUserHasStore(user);
  if (userStoreId !== resourceStoreId) {
    throw new ForbiddenException('无权操作该资源');
  }
}
