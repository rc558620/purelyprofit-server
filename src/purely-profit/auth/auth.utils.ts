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

export function normalizePhone(phone: string): string {
  return phone.trim();
}

export function buildAccountIdentifiers(phone: string): AccountIdentifiers {
  return {
    phone,
    email: `phone_${phone}@purelyprofit.local`,
  };
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

export function extractPhoneFromLoginAccount(account: string): string | null {
  return /^1[3-9]\d{9}$/.test(account) ? account : null;
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
