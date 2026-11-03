// 售卡订单列表查询 DTO 校验：线下办卡来源下线后，只接受可筛来源
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListMemberCardOrdersQueryDto } from './member-card-order-query.dto';

const validateSource = async (source: string): Promise<string[]> => {
  const dto = plainToInstance(ListMemberCardOrdersQueryDto, { source });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
};

describe('ListMemberCardOrdersQueryDto - source', () => {
  it('接受会员端购卡来源', async () => {
    await expect(validateSource('club_wechat')).resolves.toHaveLength(0);
  });

  it('接受门店赠送来源', async () => {
    await expect(validateSource('gift')).resolves.toHaveLength(0);
  });

  it('拒绝已下线的线下现金来源', async () => {
    await expect(validateSource('staff_cash')).resolves.toContain('isIn');
  });

  it('拒绝已下线的线下微信来源', async () => {
    await expect(validateSource('staff_wechat')).resolves.toContain('isIn');
  });
});
