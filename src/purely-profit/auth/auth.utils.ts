import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';
import {
  ADMIN_LOGIN_ALIAS,
  ADMIN_LOGIN_PHONE,
  AUTH_PASSWORD_RESET_CODE_KEY_PREFIX,
  AUTH_PASSWORD_RESET_CODE_LENGTH,
  AUTH_REGISTER_CODE_KEY_PREFIX,
  AUTH_SMS_SEND_COOLDOWN_KEY_PREFIX,
  AUTH_TOKEN_VERSION_KEY_PREFIX,
  PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX,
  STORE_PROFILE_KEY_PREFIX,
} from './auth.constants';
import type {
  AccountIdentifiers,
  AuthProductScope,
  AuthResolvedIdentity,
  AuthenticatedAccountScope,
} from './auth-account.types';
import type { ProfileUserRecord } from './auth-profile.types';

const LOCAL_LOGIN_DOMAIN = 'purelyprofit.local';
const PRODUCT_PHONE_LOGIN_PREFIX: Record<AuthProductScope, string> = {
  purely_profit: 'profit_phone_',
  purely_club: 'club_phone_',
};
const PRODUCT_ACCOUNT_LOGIN_PREFIX: Record<AuthProductScope, string> = {
  purely_profit: 'profit_account_',
  purely_club: 'club_account_',
};
const LEGACY_PROFIT_PHONE_LOGIN_PREFIX = 'phone_';
const LEGACY_PROFIT_ACCOUNT_LOGIN_PREFIX = 'account_';
const CLUB_WECHAT_MEMBER_PHONE_PREFIX = 'club_wechat:';
const CLUB_WECHAT_LOGIN_PREFIX = 'club_wechat_';
const MAINLAND_MOBILE_PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function normalizePhone(phone: string): string {
  return phone.trim();
}

export function normalizeLoginAccount(account: string): string {
  return account.trim().toLowerCase();
}

export function buildAccountIdentifiers(
  scope: AuthProductScope,
  phone: string,
): AccountIdentifiers {
  return {
    phone,
    email: buildPhoneLoginEmail(scope, phone),
    accountScope: scope,
  };
}

export function buildPhoneLoginEmail(
  scope: AuthProductScope,
  phone: string,
): string {
  return `${PRODUCT_PHONE_LOGIN_PREFIX[scope]}${phone}@${LOCAL_LOGIN_DOMAIN}`;
}

export function buildLoginEmailFromAccount(
  scope: AuthProductScope,
  account: string,
): string {
  return `${PRODUCT_ACCOUNT_LOGIN_PREFIX[scope]}${normalizeLoginAccount(account)}@${LOCAL_LOGIN_DOMAIN}`;
}

export function buildLegacyProfitPhoneLoginEmail(phone: string): string {
  return `${LEGACY_PROFIT_PHONE_LOGIN_PREFIX}${phone}@${LOCAL_LOGIN_DOMAIN}`;
}

export function buildLegacyProfitAccountLoginEmail(account: string): string {
  return `${LEGACY_PROFIT_ACCOUNT_LOGIN_PREFIX}${normalizeLoginAccount(account)}@${LOCAL_LOGIN_DOMAIN}`;
}

export function buildPhoneLoginEmails(
  scope: AuthProductScope,
  phone: string,
): string[] {
  const emails = [buildPhoneLoginEmail(scope, phone)];
  if (scope === 'purely_profit') {
    emails.push(buildLegacyProfitPhoneLoginEmail(phone));
  }
  return emails;
}

export function buildAccountLoginEmails(
  scope: AuthProductScope,
  account: string,
): string[] {
  const emails = [buildLoginEmailFromAccount(scope, account)];
  if (scope === 'purely_profit') {
    emails.push(buildLegacyProfitAccountLoginEmail(account));
  }
  return emails;
}

export function resolveLoginPhone(account: string): string | null {
  const normalizedAccount = account.trim();
  const matchedPhone = extractPhoneFromLoginAccount(normalizedAccount);

  if (matchedPhone) {
    return matchedPhone;
  }

  if (normalizedAccount.toLowerCase() !== ADMIN_LOGIN_ALIAS) {
    return null;
  }

  return ADMIN_LOGIN_PHONE;
}

export function resolveLoginEmail(
  scope: AuthProductScope,
  account: string,
): string | null {
  const normalizedAccount = account.trim();
  if (
    !normalizedAccount ||
    !isCustomLoginAccount(normalizedAccount) ||
    normalizedAccount.toLowerCase() === ADMIN_LOGIN_ALIAS
  ) {
    return null;
  }

  if (scope !== 'purely_profit') {
    return null;
  }

  return buildLoginEmailFromAccount(scope, normalizedAccount);
}

export function extractPhoneFromLoginAccount(account: string): string | null {
  return MAINLAND_MOBILE_PHONE_PATTERN.test(account) ? account : null;
}

export function isCustomLoginAccount(account: string): boolean {
  return /^[a-zA-Z0-9_]{6,32}$/.test(account.trim());
}

export function isReservedLoginAccount(account: string): boolean {
  return normalizeLoginAccount(account) === ADMIN_LOGIN_ALIAS;
}

export function isValidSubAccountLoginAccount(account: string): boolean {
  return isCustomLoginAccount(account) && !isReservedLoginAccount(account);
}

export function resolveSubAccountLoginEmail(
  phone: string,
  account?: string | null,
): string {
  const normalizedAccount = account?.trim();
  if (!normalizedAccount) {
    return buildAccountIdentifiers('purely_profit', phone).email;
  }

  return buildLoginEmailFromAccount('purely_profit', normalizedAccount);
}

export function extractCustomLoginAccount(email: string): string | null {
  const normalizedEmail = email.trim().toLowerCase();
  const customPrefixes = [
    PRODUCT_ACCOUNT_LOGIN_PREFIX.purely_profit,
    LEGACY_PROFIT_ACCOUNT_LOGIN_PREFIX,
  ];
  const suffix = `@${LOCAL_LOGIN_DOMAIN}`;

  if (!normalizedEmail.endsWith(suffix)) {
    return null;
  }

  const matchedPrefix = customPrefixes.find((prefix) =>
    normalizedEmail.startsWith(prefix),
  );
  if (!matchedPrefix) {
    return null;
  }

  return normalizedEmail.slice(
    matchedPrefix.length,
    normalizedEmail.length - suffix.length,
  );
}

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isSameLoginEmail(left: string, right: string): boolean {
  return normalizeLoginEmail(left) === normalizeLoginEmail(right);
}

export function resolveProductAccountScopeFromEmail(
  email: string,
): AuthProductScope | null {
  const normalizedEmail = normalizeLoginEmail(email);
  if (
    normalizedEmail.startsWith(PRODUCT_PHONE_LOGIN_PREFIX.purely_club) ||
    normalizedEmail.startsWith(PRODUCT_ACCOUNT_LOGIN_PREFIX.purely_club) ||
    normalizedEmail.startsWith(CLUB_WECHAT_LOGIN_PREFIX)
  ) {
    return 'purely_club';
  }

  if (
    normalizedEmail.startsWith(PRODUCT_PHONE_LOGIN_PREFIX.purely_profit) ||
    normalizedEmail.startsWith(PRODUCT_ACCOUNT_LOGIN_PREFIX.purely_profit) ||
    normalizedEmail.startsWith(LEGACY_PROFIT_PHONE_LOGIN_PREFIX) ||
    normalizedEmail.startsWith(LEGACY_PROFIT_ACCOUNT_LOGIN_PREFIX)
  ) {
    return 'purely_profit';
  }

  return null;
}

export function resolveAuthenticatedAccountScope(
  email: string,
  isDeveloper: boolean,
): AuthenticatedAccountScope {
  if (isDeveloper) {
    return 'developer';
  }

  return resolveProductAccountScopeFromEmail(email) ?? 'purely_profit';
}

export function isPulseDeveloperAccount(
  email: string,
  phone: string,
  pulseDevAccountEmails: Set<string>,
): boolean {
  return (
    pulseDevAccountEmails.has(normalizeLoginEmail(email)) ||
    phone === ADMIN_LOGIN_PHONE
  );
}

export function resolveAuthIdentity(
  email: string,
  phone: string,
  pulseDevAccountEmails: Set<string>,
): AuthResolvedIdentity {
  const isPulseDeveloper = isPulseDeveloperAccount(
    email,
    phone,
    pulseDevAccountEmails,
  );

  return {
    accountScope: resolveAuthenticatedAccountScope(email, isPulseDeveloper),
    isPulseDeveloper,
    pulseMode: isPulseDeveloper ? 'developer' : 'normal',
  };
}

export function isMainlandMobilePhone(phone: string): boolean {
  return MAINLAND_MOBILE_PHONE_PATTERN.test(phone);
}

export function buildClubWechatMemberPhone(openid: string): string {
  return `${CLUB_WECHAT_MEMBER_PHONE_PREFIX}${openid}`;
}

export function isClubWechatMemberPhone(phone: string): boolean {
  return phone.startsWith(CLUB_WECHAT_MEMBER_PHONE_PREFIX);
}

export function getDisplayPhone(phone: string): string {
  return isMainlandMobilePhone(phone) ? phone : '';
}

export function maskPhone(phone: string): string {
  if (!/^1\d{10}$/.test(phone)) {
    return phone;
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function buildSubAccountLoginDisplay(
  phone: string,
  loginEmail?: string | null,
): string {
  const customAccount = loginEmail
    ? extractCustomLoginAccount(loginEmail)
    : null;

  return customAccount ? `${phone} / ${customAccount}` : phone;
}

export function isVerifiedUser(
  user: Pick<ProfileUserRecord, 'realName' | 'idNumber'>,
): boolean {
  return Boolean(user.realName && user.idNumber);
}

export function maskIdNumber(idNumber: string): string {
  if (idNumber.length <= 8) {
    return idNumber;
  }

  return `${idNumber.slice(0, 6)}********${idNumber.slice(-4)}`;
}

export function ensurePasswordConfirmation(
  password: string,
  confirmPassword: string | undefined,
  message: string,
): void {
  if (confirmPassword === undefined || password !== confirmPassword) {
    throw new BadRequestException(message);
  }
}

export function generateNumericCode(
  length = AUTH_PASSWORD_RESET_CODE_LENGTH,
): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

export function buildPasswordResetCodeKey(
  scope: AuthProductScope,
  phone: string,
): string {
  return `${AUTH_PASSWORD_RESET_CODE_KEY_PREFIX}${scope}:${phone}`;
}

export function buildRegisterCodeKey(
  scope: AuthProductScope,
  phone: string,
): string {
  return `${AUTH_REGISTER_CODE_KEY_PREFIX}${scope}:${phone}`;
}

export function buildSmsSendCooldownKey(
  scene: 'register' | 'login' | 'password-reset' | 'login_or_register',
  scope: AuthProductScope,
  phone: string,
): string {
  return `${AUTH_SMS_SEND_COOLDOWN_KEY_PREFIX}${scene}:${scope}:${phone}`;
}

export function buildTokenVersionKey(userId: number): string {
  return `${AUTH_TOKEN_VERSION_KEY_PREFIX}${userId}`;
}

export function buildStoreProfileKey(storeId: number): string {
  return `${STORE_PROFILE_KEY_PREFIX}${storeId}`;
}

export function buildPulseAdminMemberBanReasonKey(storeId: number): string {
  return `${PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX}${storeId}:ban-reason`;
}
