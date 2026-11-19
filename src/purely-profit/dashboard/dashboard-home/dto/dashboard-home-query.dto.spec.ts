import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetDashboardHomeOverviewQueryDto } from './dashboard-home-query.dto';

describe('GetDashboardHomeOverviewQueryDto', () => {
  it('未传 period 时保持可选', async () => {
    const dto = plainToInstance(GetDashboardHomeOverviewQueryDto, {});

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.period).toBeUndefined();
  });

  it('非法 period 返回校验错误，不再静默降级为今日', async () => {
    const dto = plainToInstance(GetDashboardHomeOverviewQueryDto, {
      period: 'last_decade',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'period')).toBe(true);
  });

  it('已知别名与多余空白仍归一化为标准枚举', async () => {
    const dto = plainToInstance(GetDashboardHomeOverviewQueryDto, {
      period: ' today ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.period).toBe('today');
  });
});
