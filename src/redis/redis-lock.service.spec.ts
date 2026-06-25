import { Test } from '@nestjs/testing';
import { RedisLockService } from './redis-lock.service';
import { RedisService } from './redis.service';

describe('RedisLockService', () => {
  let lockService: RedisLockService;
  let redisService: jest.Mocked<RedisService>;

  const mockClient = {
    eval: jest.fn(),
  };

  beforeEach(async () => {
    const mockRedisService = {
      setIfAbsent: jest.fn(),
      getClient: jest.fn().mockReturnValue(mockClient),
    };

    const module = await Test.createTestingModule({
      providers: [
        RedisLockService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    lockService = module.get(RedisLockService);
    redisService = module.get(RedisService) as jest.Mocked<RedisService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully on first attempt', async () => {
      redisService.setIfAbsent.mockResolvedValue(true);

      const lock = await lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
      });

      expect(lock).toBeDefined();
      expect(lock?.resource).toBe('test:resource');
      expect(lock?.token).toBeDefined();
      expect(lock?.key).toBe('distributed-lock:test:resource');
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(1);
      expect(redisService.setIfAbsent).toHaveBeenCalledWith(
        'distributed-lock:test:resource',
        expect.any(String),
        10,
      );
    });

    it('should return null when lock is already held', async () => {
      redisService.setIfAbsent.mockResolvedValue(false);

      const lock = await lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
      });

      expect(lock).toBeNull();
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(1);
    });

    it('should retry acquiring lock when retryTimes is set', async () => {
      redisService.setIfAbsent
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const lock = await lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
        retryTimes: 2,
        retryDelayMs: 10,
      });

      expect(lock).toBeDefined();
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(3);
    });

    it('should return null after exhausting all retries', async () => {
      redisService.setIfAbsent.mockResolvedValue(false);

      const lock = await lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
        retryTimes: 3,
        retryDelayMs: 10,
      });

      expect(lock).toBeNull();
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });

  describe('releaseLock', () => {
    it('should release lock successfully', async () => {
      mockClient.eval.mockResolvedValue(1);

      await lockService.releaseLock({
        resource: 'test:resource',
        token: 'test-token',
        key: 'distributed-lock:test:resource',
      });

      expect(mockClient.eval).toHaveBeenCalledTimes(1);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('if redis.call'),
        1,
        'distributed-lock:test:resource',
        'test-token',
      );
    });

    it('should handle lock already expired or released', async () => {
      mockClient.eval.mockResolvedValue(0);

      await lockService.releaseLock({
        resource: 'test:resource',
        token: 'test-token',
        key: 'distributed-lock:test:resource',
      });

      expect(mockClient.eval).toHaveBeenCalledTimes(1);
    });

    it('should handle release errors gracefully', async () => {
      mockClient.eval.mockRejectedValue(new Error('Redis connection error'));

      await expect(
        lockService.releaseLock({
          resource: 'test:resource',
          token: 'test-token',
          key: 'distributed-lock:test:resource',
        }),
      ).resolves.not.toThrow();

      expect(mockClient.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe('withLock', () => {
    it('should execute function under lock successfully', async () => {
      redisService.setIfAbsent.mockResolvedValue(true);
      mockClient.eval.mockResolvedValue(1);

      const mockFn = jest.fn().mockResolvedValue('result');

      const result = await lockService.withLock(
        'test:resource',
        { ttlSeconds: 10 },
        mockFn,
      );

      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(1);
      expect(mockClient.eval).toHaveBeenCalledTimes(1);
    });

    it('should release lock even when function throws error', async () => {
      redisService.setIfAbsent.mockResolvedValue(true);
      mockClient.eval.mockResolvedValue(1);

      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));

      await expect(
        lockService.withLock('test:resource', { ttlSeconds: 10 }, mockFn),
      ).rejects.toThrow('Test error');

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockClient.eval).toHaveBeenCalledTimes(1);
    });

    it('should throw error when lock cannot be acquired', async () => {
      redisService.setIfAbsent.mockResolvedValue(false);

      const mockFn = jest.fn();

      await expect(
        lockService.withLock('test:resource', { ttlSeconds: 10 }, mockFn),
      ).rejects.toThrow('无法获取分布式锁');

      expect(mockFn).not.toHaveBeenCalled();
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(1);
    });

    it('should support retries in withLock', async () => {
      redisService.setIfAbsent
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockClient.eval.mockResolvedValue(1);

      const mockFn = jest.fn().mockResolvedValue('success');

      const result = await lockService.withLock(
        'test:resource',
        { ttlSeconds: 10, retryTimes: 2, retryDelayMs: 10 },
        mockFn,
      );

      expect(result).toBe('success');
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(2);
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockClient.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent lock requests', () => {
    it('should only allow one lock holder for same resource', async () => {
      redisService.setIfAbsent
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const lock1Promise = lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
      });
      const lock2Promise = lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
      });

      const [lock1, lock2] = await Promise.all([lock1Promise, lock2Promise]);

      expect(lock1).toBeDefined();
      expect(lock2).toBeNull();
    });
  });

  describe('lock key generation', () => {
    it('should generate unique keys for different resources', async () => {
      redisService.setIfAbsent.mockResolvedValue(true);

      const lock1 = await lockService.acquireLock('space:session:open:1', {
        ttlSeconds: 10,
      });
      const lock2 = await lockService.acquireLock('space:session:open:2', {
        ttlSeconds: 10,
      });

      expect(lock1?.key).toBe('distributed-lock:space:session:open:1');
      expect(lock2?.key).toBe('distributed-lock:space:session:open:2');
      expect(lock1?.key).not.toBe(lock2?.key);
    });

    it('should generate unique tokens for same resource', async () => {
      redisService.setIfAbsent.mockResolvedValue(true);

      const lock1 = await lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
      });
      const lock2 = await lockService.acquireLock('test:resource', {
        ttlSeconds: 10,
      });

      expect(lock1?.token).toBeDefined();
      expect(lock2?.token).toBeDefined();
      expect(lock1?.token).not.toBe(lock2?.token);
    });
  });
});
