import type {
  AuthProductScope,
  AuthenticatedAccountScope,
} from './auth-account.types';

export interface CreateUserFromPhoneParams {
  phone: string;
  name?: string;
  password: string;
  productScope: AuthProductScope;
}

export interface RegisterAuthParams {
  phone: string;
  code: string;
  password: string;
  confirmPassword?: string;
  name?: string;
  productScope: AuthProductScope;
}

export interface LoginAuthParams {
  loginAccount?: string;
  password: string;
  productScope: AuthProductScope;
  requireDeveloper?: boolean;
}

export interface LoginByCodeAuthParams {
  phone: string;
  code: string;
  productScope: AuthProductScope;
}

export interface CreatedUserFromPhoneRecord {
  id: number;
  email: string;
  accountScope: CreateUserFromPhoneParams['productScope'];
}

export interface UpdateUserPasswordParams {
  userId: number;
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordAuthParams {
  userId: number;
  phone: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword?: string;
  accountScope: AuthenticatedAccountScope;
}

export interface ResetPasswordAuthParams {
  phone: string;
  code: string;
  password: string;
  confirmPassword?: string;
  productScope: AuthProductScope;
}
