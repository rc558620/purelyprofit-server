import { SetMetadata, applyDecorators } from '@nestjs/common';

export const BLOCK_SUB_ACCOUNT_KEY = 'block_sub_account';
export const BLOCK_SUB_ACCOUNT_MESSAGE_KEY = 'block_sub_account_message';

/**
 * 装饰器：标记接口禁止子账号访问
 * 用于 store-settings 等仅限主账号访问的模块
 */
export const BlockSubAccount = (message?: string) =>
  applyDecorators(
    SetMetadata(BLOCK_SUB_ACCOUNT_KEY, true),
    ...(message ? [SetMetadata(BLOCK_SUB_ACCOUNT_MESSAGE_KEY, message)] : []),
  );

/**
 * 装饰器：显式允许子账号访问（覆盖类级 BlockSubAccount）。
 * 用于门店共享只读资源（如门店 Logo 代理），这类接口子账号同样需要。
 */
export const AllowSubAccount = () => SetMetadata(BLOCK_SUB_ACCOUNT_KEY, false);
