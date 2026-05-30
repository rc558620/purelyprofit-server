import { SetMetadata } from '@nestjs/common';

export const BLOCK_SUB_ACCOUNT_KEY = 'block_sub_account';

/**
 * 装饰器：标记接口禁止子账号访问
 * 用于 store-settings 等仅限主账号访问的模块
 */
export const BlockSubAccount = () => SetMetadata(BLOCK_SUB_ACCOUNT_KEY, true);
