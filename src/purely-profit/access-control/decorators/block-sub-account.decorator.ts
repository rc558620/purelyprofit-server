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
