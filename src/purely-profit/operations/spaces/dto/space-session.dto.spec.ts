import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CheckoutSpaceSessionPreviewDto,
  CheckoutSpaceSessionDto,
} from './space-session.dto';

describe('Space Session DTO', () => {
  it('CheckoutSpaceSessionPreviewDto 兼容 timeFeeMode 与 countdownFeeMode', async () => {
    const dto = plainToInstance(CheckoutSpaceSessionPreviewDto, {
      countdownFeeMode: 'timed',
      timeFeeMode: 'timed',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
  });

  it('CheckoutSpaceSessionDto 兼容 timeFeeMode 与 countdownFeeMode', async () => {
    const dto = plainToInstance(CheckoutSpaceSessionDto, {
      paymentMethod: 'cash',
      countdownFeeMode: 'fixed',
      timeFeeMode: 'unit_price',
      lockId: 'space_lock_xxx',
      lockedAt: 1715695200000,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
  });
});
