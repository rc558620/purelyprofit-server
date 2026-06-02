import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';
import {
  ADMIN_LOGIN_ALIAS,
  ADMIN_LOGIN_PHONE,
  AUTH_PASSWORD_RESET_CODE_KEY_PREFIX,
  AUTH_PASSWORD_RESET_CODE_LENGTH,
  AUTH_REGISTER_CODE_KEY_PREFIX,
  AUTH_TOKEN_VERSION_KEY_PREFIX,
  PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX,
  STORE_PROFILE_KEY_PREFIX,
} from './auth.constants';
import type { AccountIdentifiers } from './auth-account.types';
import type { ProfileUserRecord } from './auth-profile.types';

const LOCAL_LOGIN_DOMAIN = 'purelyprofit.local';
const PHONE_LOGIN_PREFIX = 'phone_';
const ACCOUNT_LOGIN_PREFIX = 'account_';

export function normalizePhone(phone: string): string {
  return phone.trim();
}

export function normalizeLoginAccount(account: string): string {
  return account.trim().toLowerCase();
}

export function buildAccountIdentifiers(phone: string): AccountIdentifiers {
  return {
    phone,
    email: `${PHONE_LOGIN_PREFIX}${phone}@${LOCAL_LOGIN_DOMAIN}`,
  };
}

export function buildLoginEmailFromAccount(account: string): string {
  return `${ACCOUNT_LOGIN_PREFIX}${normalizeLoginAccount(account)}@${LOCAL_LOGIN_DOMAIN}`;
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

export function resolveLoginEmail(account: string): string | null {
  const normalizedAccount = account.trim();
  if (
    !normalizedAccount ||
    !isCustomLoginAccount(normalizedAccount) ||
    normalizedAccount.toLowerCase() === ADMIN_LOGIN_ALIAS
  ) {
    return null;
  }

  return buildLoginEmailFromAccount(normalizedAccount);
}

export function extractPhoneFromLoginAccount(account: string): string | null {
  return /^1[3-9]\d{9}$/.test(account) ? account : null;
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
    return buildAccountIdentifiers(phone).email;
  }

  return buildLoginEmailFromAccount(normalizedAccount);
}

export function extractCustomLoginAccount(email: string): string | null {
  const normalizedEmail = email.trim().toLowerCase();
  const prefix = ACCOUNT_LOGIN_PREFIX;
  const suffix = `@${LOCAL_LOGIN_DOMAIN}`;

  if (
    !normalizedEmail.startsWith(prefix) ||
    !normalizedEmail.endsWith(suffix)
  ) {
    return null;
  }

  return normalizedEmail.slice(
    prefix.length,
    normalizedEmail.length - suffix.length,
  );
}

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isSameLoginEmail(left: string, right: string): boolean {
  return normalizeLoginEmail(left) === normalizeLoginEmail(right);
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
  if (confirmPassword !== undefined && password !== confirmPassword) {
    throw new BadRequestException(message);
  }
}

export function generateNumericCode(
  length = AUTH_PASSWORD_RESET_CODE_LENGTH,
): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

export function buildPasswordResetCodeKey(phone: string): string {
  return `${AUTH_PASSWORD_RESET_CODE_KEY_PREFIX}${phone}`;
}

export function buildRegisterCodeKey(phone: string): string {
  return `${AUTH_REGISTER_CODE_KEY_PREFIX}${phone}`;
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
