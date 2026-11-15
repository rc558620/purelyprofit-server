// 商家端团购券订单管理 DTO 校验测试：keyword 关键词搜索参数（修复 400: property keyword should not exist）
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  QueryVoucherOrdersDto,
  VoucherOrderStatusFilter,
  VoucherOrderTimePreset,
} from './voucher-order-management.dto';

describe('QueryVoucherOrdersDto', () => {
  it('接受 keyword 关键词搜索参数（中文姓名场景），不再报 property keyword should not exist', async () => {
    const dto = plainToInstance(QueryVoucherOrdersDto, {
      keyword: '泡澡',
      status: VoucherOrderStatusFilter.ALL,
      preset: VoucherOrderTimePreset.DAYS_30,
      limit: 20,
      offset: 0,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.keyword).toBe('泡澡');
  });

  it('空白 keyword 被 trim 为 undefined，不阻塞查询', async () => {
    const dto = plainToInstance(QueryVoucherOrdersDto, {
      keyword: '   ',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.keyword).toBeUndefined();
  });

  it('接受 cursor 游标参数（与 offset 并存，白名单不拦截）', async () => {
    const dto = plainToInstance(QueryVoucherOrdersDto, {
      cursor: 'v1:eyJrZXlzIjpbMTc2MzIyNTYwMDAwMF0sImlkIjo0Mn0',
      limit: 20,
      offset: 0,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.cursor).toBe('v1:eyJrZXlzIjpbMTc2MzIyNTYwMDAwMF0sImlkIjo0Mn0');
  });

  it('拒绝超长 cursor，避免把任意字符串当游标塞进查询', async () => {
    const dto = plainToInstance(QueryVoucherOrdersDto, {
      cursor: `v1:${'a'.repeat(300)}`,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(['cursor']);
  });
});
