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

/** 通过微信 openid 创建用户的参数（无密码，使用随机哈希占位） */
export interface CreateUserFromWechatParams {
  openid: string;
  unionid?: string;
  nickname?: string;
  avatar?: string;
  /** 微信授权的真实手机号（通过 open-type=getPhoneNumber 获取，E.164 已去前缀的纯数字格式） */
  phone?: string;
  productScope: AuthProductScope;
}

export interface RegisterAuthParams {
  phone: string;
  code: string;
  password: string;
  confirmPassword?: string;
  name?: string;
  productScope: AuthProductScope;
  /** 推广码（选填），8位字母数字 */
  promoCode?: string;
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

/**
 * 微信小程序登录参数
 * openid 由 code2session 换取，前端传入昵称/头像（可选）供首次注册时填充
 */
export interface WechatLoginAuthParams {
  openid: string;
  unionid?: string;
  /** 微信昵称，首次注册时写入 */
  nickname?: string;
  /** 微信头像 URL，首次注册时写入 */
  avatar?: string;
  /** 微信授权的真实手机号（通过 open-type=getPhoneNumber 获取，纯数字格式如 13800138000）。
   * 若传入，服务端将尝试与该手机号对应的已有账号合并，或在创建新账号时直接写入手机号。
   */
  phone?: string;
  productScope: AuthProductScope;
}

/**
 * 手机号验证码登录即注册参数
 * 若用户不存在则自动以手机号创建账号，省去单独注册流程
 */
export interface LoginByCodeOrRegisterAuthParams {
  phone: string;
  code: string;
  productScope: AuthProductScope;
}
