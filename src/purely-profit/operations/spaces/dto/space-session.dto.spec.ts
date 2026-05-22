import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CheckoutSpaceSessionPreviewDto,
  CheckoutSpaceSessionDto,
} from './space-session.dto';

describe('Space Session DTO', () => {
  it('CheckoutSpaceSessionPreviewDto 仅接受 countdownFeeMode，不接受 timeFeeMode', async () => {
    const dto = plainToInstance(CheckoutSpaceSessionPreviewDto, {
      countdownFeeMode: 'timed',
      timeFeeMode: 'timed',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toMatchObject({
      whitelistValidation: 'property timeFeeMode should not exist',
    });
  });

  it('CheckoutSpaceSessionDto 仅接受 countdownFeeMode，不接受 timeFeeMode', async () => {
    const dto = plainToInstance(CheckoutSpaceSessionDto, {
      paymentMethod: 'cash',
      countdownFeeMode: 'fixed',
      timeFeeMode: 'unit_price',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toMatchObject({
      whitelistValidation: 'property timeFeeMode should not exist',
    });
  });
});
