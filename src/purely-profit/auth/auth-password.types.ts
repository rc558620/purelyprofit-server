export interface CreateUserFromPhoneParams {
  phone: string;
  name?: string;
  password: string;
}

export interface RegisterAuthParams {
  phone: string;
  code: string;
  password: string;
  confirmPassword?: string;
  name?: string;
}

export interface LoginAuthParams {
  loginAccount?: string;
  password: string;
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
}

export interface ResetPasswordAuthParams {
  phone: string;
  code: string;
  password: string;
  confirmPassword?: string;
}
