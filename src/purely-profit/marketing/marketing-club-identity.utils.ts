// ─── Club 账号派生 email 规则（营销侧只读消费）──────────────────────────
//
// purelyClub 的微信/手机号用户在 users.email 上没有真实邮箱，认证域会按
// 「前缀 + 手机号 + 域名」派生一个占位 email；营销侧靠它反查 users 表取头像。
//
// ⚠️ 这是**认证域的命名规则**，营销侧只是读取方。所有拼接必须共用这里的常量：
// 一旦 auth 侧调整规则，散落的字面量会静默失效，而编译器不会报任何错。

/** 派生 email 的域名 */
export const CLUB_DERIVED_EMAIL_DOMAIN = 'purelyprofit.local';

/** 当前前缀（Club 微信 / 手机号用户） */
export const CLUB_PHONE_EMAIL_PREFIX = 'club_phone_';

/** 历史前缀（早期注册路径），仍有存量数据 */
export const LEGACY_PHONE_EMAIL_PREFIX = 'phone_';

/** 按前缀 + 手机号拼出派生 email */
export function buildClubDerivedEmail(prefix: string, phone: string): string {
  return `${prefix}${phone}@${CLUB_DERIVED_EMAIL_DOMAIN}`;
}

/** 列出某手机号所有可能的派生 email，数组顺序即匹配优先级 */
export function buildClubDerivedEmails(phone: string): string[] {
  return [
    buildClubDerivedEmail(CLUB_PHONE_EMAIL_PREFIX, phone),
    buildClubDerivedEmail(LEGACY_PHONE_EMAIL_PREFIX, phone),
  ];
}
