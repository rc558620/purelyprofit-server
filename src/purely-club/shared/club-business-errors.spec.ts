import { BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from '../../bootstrap/all-exceptions.filter';
import {
  CLUB_AUTH_ERROR_CODE,
  CLUB_AUTH_ERROR_CODE_PREFIX,
} from '../auth/club-auth.errors';
import {
  CLUB_CARD_ERROR_CODE,
  CLUB_CARD_ERROR_CODE_PREFIX,
} from '../cards/club-cards.errors';
import {
  CLUB_CARE_RECORD_ERROR_CODE,
  CLUB_CARE_RECORD_ERROR_CODE_PREFIX,
} from '../care-records/club-care-records.errors';
import {
  CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE,
  CHECK_IN_ACTIVITY_NOT_FOUND_CODE,
  CHECK_IN_ALREADY_DONE_CODE,
  buildCheckInBusinessError,
} from '../check-in/club-check-in.errors';
import {
  CLUB_CUSTODY_ERROR_CODE,
  CLUB_CUSTODY_ERROR_CODE_PREFIX,
} from '../custody/club-custody.errors';
import {
  CLUB_HOME_ERROR_CODE,
  CLUB_HOME_ERROR_CODE_PREFIX,
} from '../home/club-home.errors';
import {
  CLUB_MEMBER_ERROR_CODE,
  CLUB_MEMBER_ERROR_CODE_PREFIX,
} from '../member/club-member.errors';
import {
  CLUB_ORDER_ERROR_CODE,
  CLUB_ORDER_ERROR_CODE_PREFIX,
} from '../orders/club-orders.errors';
import {
  CLUB_PAY_ERROR_CODE,
  CLUB_PAY_ERROR_CODE_PREFIX,
} from '../payments/club-pay.errors';
import {
  STORE_PAY_CONFIG_MISSING_CODE,
  buildStorePayConfigMissingError,
} from '../payments/club-wechat-pay.errors';
import {
  CLUB_POINTS_ERROR_CODE,
  CLUB_POINTS_ERROR_CODE_PREFIX,
} from '../points/club-points.errors';
import {
  CLUB_PRODUCT_ERROR_CODE,
  CLUB_PRODUCT_ERROR_CODE_PREFIX,
} from '../products/club-products.errors';
import {
  CLUB_RECHARGE_ERROR_CODE,
  CLUB_RECHARGE_ERROR_CODE_PREFIX,
} from '../recharge/club-recharge.errors';
import {
  CLUB_RECORD_ERROR_CODE,
  CLUB_RECORD_ERROR_CODE_PREFIX,
} from '../records/club-records.errors';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  CLUB_SCAN_ORDERING_ERROR_CODE_PREFIX,
} from '../scan-ordering/club-scan-ordering.errors';
import {
  CLUB_SELF_ORDERING_ERROR_CODE,
  CLUB_SELF_ORDERING_ERROR_CODE_PREFIX,
} from '../self-ordering/club-self-ordering.errors';
import {
  CLUB_SERVICE_CALL_ERROR_CODE,
  CLUB_SERVICE_CALL_ERROR_CODE_PREFIX,
} from '../service-call/club-service-call.errors';
import { CLUB_NO_ACCESSIBLE_STORE_CODE } from '../stores/club-current-store-context.service';
import {
  CLUB_STORES_ERROR_CODE,
  CLUB_STORES_ERROR_CODE_PREFIX,
} from '../stores/club-stores.errors';
import {
  CLUB_VOUCHER_ERROR_CODE,
  CLUB_VOUCHER_ERROR_CODE_PREFIX,
} from '../voucher-orders/club-voucher-orders.errors';
import {
  CLUB_ERROR_CODE_CLASS,
  CLUB_LEGACY_ERROR_CODE,
  clubBusinessError,
  inspectClubErrorCodeTable,
  inspectFrozenErrorCodeValues,
} from './club-business-errors';

/**
 * 共享层锁住的是跨仓库契约：后端下发 code → 全局过滤器透传 →
 * purelyClub 按 code 分支。各域码表只需复用这里的校验，不必各写一遍。
 */
describe('C 端业务错误码共享基础设施', () => {
  const code = 'CLUB_X_PARAM_A';
  const message = '中文文案';

  it('构造器返回 { code, message }，且不改写文案', () => {
    expect(clubBusinessError(code, message)).toEqual({ code, message });
  });

  it('HttpException 的 Error.message 仍是中文，旧前端文案兜底不失效', () => {
    const error = new BadRequestException(clubBusinessError(code, message));

    expect(error.message).toBe(message);
    expect(error.getResponse()).toMatchObject({ code, message });
  });

  it('全局异常过滤器把 code 透传到响应体', () => {
    const error = new BadRequestException(clubBusinessError(code, message));
    const send = jest.fn();
    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      send,
    };
    const mockRequest = {
      method: 'POST',
      url: '/api/club/x',
      id: 'req-1',
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter(true).catch(error, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message, code }),
    );
  });

  it('码表校验能识别缺前缀 / 重复值 / 非法分类段', () => {
    const problems = inspectClubErrorCodeTable(
      {
        A: 'CLUB_X_PARAM_A',
        B: 'CLUB_X_PARAM_A',
        C: 'OTHER_STATUS_C',
        D: 'CLUB_X_UNKNOWN_D',
      },
      'CLUB_X_',
    );

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('码值重复'),
        expect.stringContaining('缺少前缀'),
        expect.stringContaining('分类段 UNKNOWN 不合法'),
      ]),
    );
  });

  it.each([
    ['recharge', CLUB_RECHARGE_ERROR_CODE, CLUB_RECHARGE_ERROR_CODE_PREFIX],
    ['cards', CLUB_CARD_ERROR_CODE, CLUB_CARD_ERROR_CODE_PREFIX],
    ['orders', CLUB_ORDER_ERROR_CODE, CLUB_ORDER_ERROR_CODE_PREFIX],
    ['stores', CLUB_STORES_ERROR_CODE, CLUB_STORES_ERROR_CODE_PREFIX],
    [
      'scan-ordering',
      CLUB_SCAN_ORDERING_ERROR_CODE,
      CLUB_SCAN_ORDERING_ERROR_CODE_PREFIX,
    ],
    [
      'self-ordering',
      CLUB_SELF_ORDERING_ERROR_CODE,
      CLUB_SELF_ORDERING_ERROR_CODE_PREFIX,
    ],
    ['voucher-orders', CLUB_VOUCHER_ERROR_CODE, CLUB_VOUCHER_ERROR_CODE_PREFIX],
    ['auth', CLUB_AUTH_ERROR_CODE, CLUB_AUTH_ERROR_CODE_PREFIX],
    [
      'care-records',
      CLUB_CARE_RECORD_ERROR_CODE,
      CLUB_CARE_RECORD_ERROR_CODE_PREFIX,
    ],
    ['custody', CLUB_CUSTODY_ERROR_CODE, CLUB_CUSTODY_ERROR_CODE_PREFIX],
    ['home', CLUB_HOME_ERROR_CODE, CLUB_HOME_ERROR_CODE_PREFIX],
    ['member', CLUB_MEMBER_ERROR_CODE, CLUB_MEMBER_ERROR_CODE_PREFIX],
    ['payments', CLUB_PAY_ERROR_CODE, CLUB_PAY_ERROR_CODE_PREFIX],
    ['points', CLUB_POINTS_ERROR_CODE, CLUB_POINTS_ERROR_CODE_PREFIX],
    ['products', CLUB_PRODUCT_ERROR_CODE, CLUB_PRODUCT_ERROR_CODE_PREFIX],
    ['records', CLUB_RECORD_ERROR_CODE, CLUB_RECORD_ERROR_CODE_PREFIX],
    [
      'service-call',
      CLUB_SERVICE_CALL_ERROR_CODE,
      CLUB_SERVICE_CALL_ERROR_CODE_PREFIX,
    ],
  ])('%s 域码表符合命名约定', (_domain, codes, prefix) => {
    expect(inspectClubErrorCodeTable(codes, prefix)).toEqual([]);
  });

  it('分类清单覆盖规范要求的基本类别', () => {
    expect(Object.values(CLUB_ERROR_CODE_CLASS)).toEqual(
      expect.arrayContaining([
        'PARAM',
        'AUTH',
        'RESOURCE',
        'STATUS',
        'DEPENDENCY',
        'SYSTEM',
      ]),
    );
  });

  it('历史码冻结清单的五个值逐字不变', () => {
    // 这五个值已被前端按字面量分支，尤其 NO_ACCESSIBLE_STORE 驱动
    // purelyClub 的「清缓存 + 跳选店页」兜底，改值会让多门店用户卡死。
    expect(CLUB_LEGACY_ERROR_CODE).toEqual({
      NO_ACCESSIBLE_STORE: 'NO_ACCESSIBLE_STORE',
      STORE_PAY_CONFIG_MISSING: 'STORE_PAY_CONFIG_MISSING',
      CHECK_IN_ALREADY_DONE: 'CHECK_IN_ALREADY_DONE',
      CHECK_IN_ACTIVITY_NOT_ACTIVE: 'CHECK_IN_ACTIVITY_NOT_ACTIVE',
      CHECK_IN_ACTIVITY_NOT_FOUND: 'CHECK_IN_ACTIVITY_NOT_FOUND',
    });
  });

  it('三个历史域导出的码值仍在冻结清单内', () => {
    expect(
      inspectFrozenErrorCodeValues(
        {
          NO_ACCESSIBLE_STORE: CLUB_NO_ACCESSIBLE_STORE_CODE,
          STORE_PAY_CONFIG_MISSING: STORE_PAY_CONFIG_MISSING_CODE,
          CHECK_IN_ALREADY_DONE: CHECK_IN_ALREADY_DONE_CODE,
          CHECK_IN_ACTIVITY_NOT_ACTIVE: CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE,
          CHECK_IN_ACTIVITY_NOT_FOUND: CHECK_IN_ACTIVITY_NOT_FOUND_CODE,
        },
        CLUB_LEGACY_ERROR_CODE,
      ),
    ).toEqual([]);
  });

  it('冻结校验能发现有人把历史码「规范化」改值', () => {
    expect(
      inspectFrozenErrorCodeValues(
        { NO_ACCESSIBLE_STORE: 'CLUB_STORES_RESOURCE_STORE_NOT_FOUND' },
        CLUB_LEGACY_ERROR_CODE,
      ),
    ).toHaveLength(1);
  });

  it('签到 builder 仍产出带 code 与中文 message 的 400', () => {
    const error = buildCheckInBusinessError(CHECK_IN_ALREADY_DONE_CODE);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      code: CHECK_IN_ALREADY_DONE_CODE,
      message: '今日已签到',
    });
    expect(error.message).toBe('今日已签到');
  });

  it('门店收款配置 builder 仍产出带 code 与中文 message 的 400', () => {
    const error = buildStorePayConfigMissingError();

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      code: STORE_PAY_CONFIG_MISSING_CODE,
      message: '该门店暂不支持在线充值，请联系门店',
    });
  });
});
