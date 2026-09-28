import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PulseAdminMemberSubAccountAmountBackfillDto } from './pulse-membership-admin-members.request.dto';

/**
 * 子账号加价补录 / 撤销的入参校验。
 *
 * 关键边界是**空串**：它在业务上表示「撤销补录」，但 @IsOptional 只跳过
 * null / undefined，空串会走到 @Matches 被判非法 → 400，撤销就永远提交不了。
 * 因此 Transform 必须把空串转成 undefined，这条用例就是钉住这个行为。
 */
describe('PulseAdminMemberSubAccountAmountBackfillDto', () => {
  const build = (payload: Record<string, unknown>) =>
    plainToInstance(PulseAdminMemberSubAccountAmountBackfillDto, payload);

  it('补录：金额与数量合法时通过校验', async () => {
    const dto = build({
      planId: 'yearly',
      subAccountAmountDisplay: '150',
      subAccountCount: 3,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.subAccountAmountDisplay).toBe('150');
    expect(dto.subAccountCount).toBe(3);
  });

  it('撤销：空串等价于未传，不被 @Matches 拦成 400', async () => {
    const dto = build({
      planId: 'yearly',
      subAccountAmountDisplay: '',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.subAccountAmountDisplay).toBeUndefined();
  });

  it('撤销：只含空白字符的串同样等价未传', async () => {
    const dto = build({
      planId: 'yearly',
      subAccountAmountDisplay: '   ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.subAccountAmountDisplay).toBeUndefined();
  });

  it('金额两侧空格会被 trim', async () => {
    const dto = build({
      planId: 'yearly',
      subAccountAmountDisplay: ' 12.5 ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.subAccountAmountDisplay).toBe('12.5');
  });

  it('加价允许填 0（明确表示不收子账号的钱）', async () => {
    const dto = build({
      planId: 'yearly',
      subAccountAmountDisplay: '0',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.subAccountAmountDisplay).toBe('0');
  });

  it('非法金额仍被拦截：负数 / 超过两位小数 / 非数字', async () => {
    for (const value of ['-1', '1.234', 'abc']) {
      const dto = build({ planId: 'yearly', subAccountAmountDisplay: value });

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    }
  });

  it('planId 必填且必须是合法档位', async () => {
    await expect(
      validate(build({ subAccountAmountDisplay: '150' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ planId: 'decade', subAccountAmountDisplay: '150' })),
    ).resolves.not.toHaveLength(0);
  });
});
