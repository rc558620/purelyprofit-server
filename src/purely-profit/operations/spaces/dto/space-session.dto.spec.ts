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

  it('CheckoutSpaceSessionDto 接受多资产抵扣明细与预期应付', async () => {
    const dto = plainToInstance(CheckoutSpaceSessionDto, {
      paymentMethod: 'cash',
      lockId: 'space_lock_xxx',
      lockedAt: 1715695200000,
      expectedPayable: 20,
      settlements: [
        { kind: 'member_card', target: 'time_fee', assetId: '8', amount: 100 },
        { kind: 'voucher', target: 'items', assetId: 'VC-1', amount: 50 },
        { kind: 'balance', target: 'total', amount: 20 },
      ],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
  });

  it('CheckoutSpaceSessionDto 拒绝非法的抵扣资产类型与负数预期应付', async () => {
    const dto = plainToInstance(CheckoutSpaceSessionDto, {
      paymentMethod: 'cash',
      lockId: 'space_lock_xxx',
      lockedAt: 1715695200000,
      expectedPayable: -1,
      settlements: [{ kind: 'unknown_asset', target: 'total', amount: 1 }],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const errorProperties = errors.map((error) => error.property);
    expect(errorProperties).toEqual(
      expect.arrayContaining(['settlements', 'expectedPayable']),
    );
  });
});
