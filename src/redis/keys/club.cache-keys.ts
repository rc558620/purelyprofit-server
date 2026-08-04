/**
 * purelyClub 端缓存键（邀请码域）。
 */

/** inviteCode→storeId 全量映射缓存 key（全局单 key，不分门店）。 */
export function buildClubInviteCodeMapCacheKey(): string {
  return 'club:invite-code-map';
}
