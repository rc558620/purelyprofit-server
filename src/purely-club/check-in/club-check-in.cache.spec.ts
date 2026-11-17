import type { RedisService } from '../../redis/redis.service';
import { buildClubCheckInPromotionCacheKey } from '../../redis/keys/club-cache-keys';
import { ClubCheckInCacheService } from './club-check-in.cache.service';
import type { CheckInStatusResponseDto } from './dto/club-check-in.dto';

const STORE_ID = 11;
const USER_ID = 201;
const CHECK_IN_DATE = '2026-11-06';

const START_AT = new Date('2026-11-01T00:00:00.000Z');
const END_AT = new Date('2026-12-01T00:00:00.000Z');

interface RedisMock {
  getJson: jest.Mock;
  mgetJson: jest.Mock;
  setJson: jest.Mock;
  del: jest.Mock;
}

const createRedisMock = (): RedisMock => ({
  getJson: jest.fn().mockResolvedValue(null),
  mgetJson: jest.fn().mockResolvedValue([null, null]),
  setJson: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
});

const createService = (redis: RedisMock): ClubCheckInCacheService =>
  new ClubCheckInCacheService(redis as unknown as RedisService);

const STATUS: CheckInStatusResponseDto = {
  activityEnabled: true,
  activityStartAt: START_AT.getTime(),
  activityEndAt: END_AT.getTime(),
  todayCheckedIn: false,
  continuousDays: 2,
  pointsPerCheckIn: 3,
  pointsBalance: 128,
  checkedDates: ['2026-11-04'],
  serverTime: START_AT.getTime(),
};

describe('ClubCheckInCacheService · 签到读缓存', () => {
  describe('活动配置', () => {
    it('未命中返回 undefined（调用方据此回源 DB）', async () => {
      const redis = createRedisMock();
      const service = createService(redis);

      await expect(service.readPromotion(STORE_ID)).resolves.toBeUndefined();
    });

    it('命中时把毫秒时间戳还原成 Date', async () => {
      const redis = createRedisMock();
      redis.getJson.mockResolvedValue({
        found: true,
        record: {
          id: 7,
          enabled: true,
          startAt: START_AT.getTime(),
          endAt: END_AT.getTime(),
          params: { pointsPerCheckIn: 3 },
        },
      });
      const service = createService(redis);

      const record = await service.readPromotion(STORE_ID);

      expect(record).toEqual({
        id: 7,
        enabled: true,
        startAt: START_AT,
        endAt: END_AT,
        params: { pointsPerCheckIn: 3 },
      });
      expect(record?.startAt).toBeInstanceOf(Date);
    });

    it('哨兵命中返回 null（门店确实未配置签到活动），不再回源', async () => {
      const redis = createRedisMock();
      redis.getJson.mockResolvedValue({ found: false });
      const service = createService(redis);

      await expect(service.readPromotion(STORE_ID)).resolves.toBeNull();
    });

    it('写入时 Date 转毫秒，未配置活动写哨兵', async () => {
      const redis = createRedisMock();
      const service = createService(redis);

      await service.writePromotion(STORE_ID, {
        id: 7,
        enabled: true,
        startAt: START_AT,
        endAt: END_AT,
        params: { pointsPerCheckIn: 3 },
      });
      await service.writePromotion(STORE_ID, null);

      expect(redis.setJson.mock.calls[0][0]).toBe(
        buildClubCheckInPromotionCacheKey(STORE_ID),
      );
      expect(redis.setJson.mock.calls[0][1]).toEqual({
        found: true,
        record: {
          id: 7,
          enabled: true,
          startAt: START_AT.getTime(),
          endAt: END_AT.getTime(),
          params: { pointsPerCheckIn: 3 },
        },
      });
      expect(redis.setJson.mock.calls[1][1]).toEqual({ found: false });
    });

    it('Redis 读取异常降级为未命中，不抛出', async () => {
      const redis = createRedisMock();
      redis.getJson.mockRejectedValue(new Error('redis down'));
      const service = createService(redis);

      await expect(service.readPromotion(STORE_ID)).resolves.toBeUndefined();
    });
  });

  describe('签到状态', () => {
    it('key 由门店 + 用户 + 上海自然日组成（跨日自动换 key）', async () => {
      const redis = createRedisMock();
      const service = createService(redis);

      await service.writeStatus(STORE_ID, USER_ID, CHECK_IN_DATE, STATUS);
      await service.deleteStatus(STORE_ID, USER_ID, CHECK_IN_DATE);

      const expectedKey = `club:check-in-status:store:${STORE_ID}:user:${USER_ID}:day:${CHECK_IN_DATE}`;
      expect(redis.setJson.mock.calls[0][0]).toBe(expectedKey);
      expect(redis.setJson.mock.calls[0][1]).toEqual(STATUS);
      expect(redis.del.mock.calls[0][0]).toBe(expectedKey);
    });

    it('合并读取用一次 MGET，同时命中状态与活动配置', async () => {
      const redis = createRedisMock();
      redis.mgetJson = jest.fn().mockResolvedValue([
        STATUS,
        {
          found: true,
          record: {
            id: 7,
            enabled: true,
            startAt: START_AT.getTime(),
            endAt: END_AT.getTime(),
            params: { pointsPerCheckIn: 3 },
          },
        },
      ]);
      const service = createService(redis);

      const { status, promotion } = await service.readStatusAndPromotion(
        STORE_ID,
        USER_ID,
        CHECK_IN_DATE,
      );

      expect(redis.mgetJson).toHaveBeenCalledTimes(1);
      expect(redis.mgetJson.mock.calls[0][0]).toEqual([
        `club:check-in-status:store:${STORE_ID}:user:${USER_ID}:day:${CHECK_IN_DATE}`,
        `club:check-in-promotion:store:${STORE_ID}`,
      ]);
      expect(status).toEqual(STATUS);
      expect(promotion?.startAt).toBeInstanceOf(Date);
    });

    it('合并读取异常时两者都按未命中降级，不抛出', async () => {
      const redis = createRedisMock();
      redis.mgetJson = jest.fn().mockRejectedValue(new Error('redis down'));
      const service = createService(redis);

      await expect(
        service.readStatusAndPromotion(STORE_ID, USER_ID, CHECK_IN_DATE),
      ).resolves.toEqual({ status: null, promotion: undefined });
    });

    it('写入带 TTL（不落永久缓存）', async () => {
      const redis = createRedisMock();
      const service = createService(redis);

      await service.writeStatus(STORE_ID, USER_ID, CHECK_IN_DATE, STATUS);

      expect(redis.setJson.mock.calls[0][2]).toBeGreaterThan(0);
    });

    it('删除失败不影响调用方（签到已落账）', async () => {
      const redis = createRedisMock();
      redis.del.mockRejectedValue(new Error('redis down'));
      const service = createService(redis);

      await expect(
        service.deleteStatus(STORE_ID, USER_ID, CHECK_IN_DATE),
      ).resolves.toBeUndefined();
    });
  });
});
