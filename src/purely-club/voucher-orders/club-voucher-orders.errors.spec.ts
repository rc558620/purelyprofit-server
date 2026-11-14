import { BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from '../../bootstrap/all-exceptions.filter';
import { CLUB_VOUCHER_VERIFY_EXPIRED_MESSAGE } from './club-voucher-orders.constants';
import {
  CLUB_VOUCHER_ERROR_CODE,
  clubVoucherError,
} from './club-voucher-orders.errors';

/**
 * 团购券错误码是一条跨仓库契约：后端下发 code → 全局过滤器透传 →
 * purelyClub 按 code 分支。同时必须保留中文 message，否则按文案兜底的
 * 旧前端与现有 toThrow('文案') 断言会集体失效。
 */
describe('团购券业务错误码契约', () => {
  const code = CLUB_VOUCHER_ERROR_CODE.RULE_VERIFY_EXPIRED;
  const message = CLUB_VOUCHER_VERIFY_EXPIRED_MESSAGE;

  it('载荷同时保留中文 message 与稳定 code', () => {
    expect(clubVoucherError(code, message)).toEqual({ code, message });
  });

  it('HttpException 的 Error.message 仍是中文，旧前端文案兜底不失效', () => {
    const error = new BadRequestException(clubVoucherError(code, message));

    expect(error.message).toBe(message);
    expect(error.getResponse()).toMatchObject({ code, message });
  });

  it('全局异常过滤器把 code 透传到响应体', () => {
    const error = new BadRequestException(clubVoucherError(code, message));
    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const mockRequest = {
      method: 'POST',
      url: '/api/club/voucher-orders/VO1/verify',
      id: 'req-1',
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter(true).catch(error, host);

    expect(mockResponse.send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message, code }),
    );
  });

  it('码值唯一且按 RESOURCE / STATUS / RULE / DEPENDENCY 分类组织', () => {
    const codes = Object.values(CLUB_VOUCHER_ERROR_CODE);

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((item) => item.startsWith('CLUB_VOUCHER_'))).toBe(true);
    expect(codes.some((item) => item.includes('_RESOURCE_'))).toBe(true);
    expect(codes.some((item) => item.includes('_STATUS_'))).toBe(true);
    expect(codes.some((item) => item.includes('_RULE_'))).toBe(true);
    expect(codes.some((item) => item.includes('_DEPENDENCY_'))).toBe(true);
  });
});
