// 提现 DTO 非空校验回归用例：判空统一收敛在入口，而非散落在 service
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyWithdrawalDto } from './dto/apply-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/review-withdrawal.dto';

const makeApplyPayload = () => ({
  beanAmount: 500,
  accountType: 'wechat',
  accountNo: 'wxid_abc',
  accountName: '张三',
});

const invalidProperties = async (dto: object): Promise<string[]> => {
  const errors = await validate(dto);
  return errors.map((error) => error.property);
};

describe('提现 DTO 非空校验', () => {
  it('合法申请参数通过校验', async () => {
    const dto = plainToInstance(ApplyWithdrawalDto, makeApplyPayload());

    await expect(invalidProperties(dto)).resolves.toEqual([]);
  });

  it('收款账号为空白字符时被入口拒绝', async () => {
    const dto = plainToInstance(ApplyWithdrawalDto, {
      ...makeApplyPayload(),
      accountNo: '   ',
    });

    await expect(invalidProperties(dto)).resolves.toContain('accountNo');
  });

  it('收款人姓名为空白字符时被入口拒绝', async () => {
    const dto = plainToInstance(ApplyWithdrawalDto, {
      ...makeApplyPayload(),
      accountName: '   ',
    });

    await expect(invalidProperties(dto)).resolves.toContain('accountName');
  });

  it('拒绝原因为空白字符时被入口拒绝', async () => {
    const dto = plainToInstance(RejectWithdrawalDto, { reason: '   ' });

    await expect(invalidProperties(dto)).resolves.toContain('reason');
  });
});
