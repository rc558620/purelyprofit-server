import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessEventsService } from './business-events.service';
import type { BusinessEventReportDto } from './dto/business-event-report.dto';

describe('BusinessEventsService', () => {
  const createPayload = (
    overrides: Partial<BusinessEventReportDto> = {},
  ): BusinessEventReportDto => ({
    eventId: 'evt_1719500000000_ab12cd',
    name: 'membership_banner_view',
    occurredAt: '2026-09-14T09:30:00.000Z',
    pathname: '/home',
    planTier: 'free',
    properties: { state: 'expired' },
    ...overrides,
  });

  const createService = (
    config: Record<string, unknown> = {},
  ): { service: BusinessEventsService; logSpy: jest.SpyInstance } => {
    const configService = {
      get: (key: string) => config[key],
    } as unknown as ConfigService;
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    return { service: new BusinessEventsService(configService), logSpy };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('开启时落一条结构化日志，便于日志管线按事件名聚合', () => {
    const { service, logSpy } = createService({
      'app.businessEventLogEnabled': true,
    });

    service.report(createPayload());

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(logSpy.mock.calls[0][0])) as Record<string, unknown>;

    expect(logged.kind).toBe('business-event');
    expect(logged.name).toBe('membership_banner_view');
    expect(logged.pathname).toBe('/home');
    expect(logged.properties).toEqual({ state: 'expired' });
  });

  it('关闭开关后不落任何日志', () => {
    const { service, logSpy } = createService({
      'app.businessEventLogEnabled': false,
    });

    service.report(createPayload());

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('未显式配置时默认开启', () => {
    const { service, logSpy } = createService({});

    service.report(createPayload());

    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('用 log 级别而非 warn/error，避免污染错误告警链路', () => {
    const { service } = createService();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    service.report(createPayload());

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
