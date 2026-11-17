// 客存取件码「换码」原子脚本的单测：1 次 RTT + 两条边界分支
import {
  CustodyCodeService,
  ISSUE_PICKUP_CODE_REPLACING_LUA,
} from './custody-code.service';
import type { RedisService } from '../../redis/redis.service';
import {
  CODE_ISSUE_MAX_RETRY,
  CUSTODY_CODE_LENGTH,
  CUSTODY_PICKUP_CODE_KEY_PREFIX,
  CUSTODY_PICKUP_ORDER_KEY_PREFIX,
  PICKUP_CODE_TTL_SECONDS,
} from './custody-code.constants';

describe('CustodyCodeService 取件码换码', () => {
  const evalMock = jest.fn();
  const redisService = {
    getClient: (): { eval: jest.Mock } => ({ eval: evalMock }),
    get: jest.fn(),
    del: jest.fn(),
    setJson: jest.fn(),
    getJson: jest.fn(),
    setIfAbsent: jest.fn(),
    delMany: jest.fn(),
    executePipeline: jest.fn(),
    hgetJson: jest.fn(),
    hsetJson: jest.fn(),
    incr: jest.fn(),
  } as unknown as RedisService;

  const service = new CustodyCodeService(redisService);

  /** eval 调用参数：脚本 / key 数 / KEYS[1] / ARGV */
  const lastEval = (): {
    numKeys: number;
    key: unknown;
    args: string[];
  } => {
    const call = evalMock.mock.calls.at(-1)!;
    return {
      numKeys: call[1] as number,
      key: call[2],
      args: call.slice(3) as string[],
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    evalMock.mockResolvedValue('123456');
  });

  it('一次 eval 完成换码，只有 1 次 RTT（不再 read/cancel/issue/bind 四次）', async () => {
    const issued = await service.issuePickupCodeReplacing(88, {
      custodyOrderId: 88,
      storeId: 7,
    });

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0]![0]).toBe(ISSUE_PICKUP_CODE_REPLACING_LUA);
    expect(issued.code).toBe('123456');
    expect(Date.parse(issued.expiresAt)).toBeGreaterThanOrEqual(
      Date.now() + (PICKUP_CODE_TTL_SECONDS - 1) * 1000,
    );

    const call = lastEval();
    expect(call.numKeys).toBe(1);
    // KEYS[1] 是存单绑定键；码键由脚本按前缀拼出，不必逐个当 key 传入
    expect(call.key).toBe(`${CUSTODY_PICKUP_ORDER_KEY_PREFIX}88`);
    expect(call.args[0]).toBe(CUSTODY_PICKUP_CODE_KEY_PREFIX);
    expect(call.args[1]).toBe('88');
    expect(JSON.parse(call.args[2]!)).toEqual({
      custodyOrderId: 88,
      storeId: 7,
    });
    expect(call.args[4]).toBe(String(PICKUP_CODE_TTL_SECONDS));

    // 候选码全量传入（纯数字），由脚本逐个 EXISTS 抢占
    const candidates = call.args.slice(5);
    expect(candidates).toHaveLength(CODE_ISSUE_MAX_RETRY);
    for (const candidate of candidates) {
      expect(candidate).toMatch(new RegExp(`^\\d{${CUSTODY_CODE_LENGTH}}$`));
    }
  });

  it('边界一：旧码不存在时脚本跳过清理（GET 为空不进入删除分支）', () => {
    // 先取旧绑定，再判空：绑定不存在（首次出码 / 已过期）时不做任何 DEL
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain(
      "local previous = redis.call('GET', orderKey)",
    );
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain('if previous then');
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain(
      "local rawPrevious = redis.call('GET', previousKey)",
    );
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain('if rawPrevious then');
  });

  it('边界二：旧码归属他人时只丢指针，绝不删除别人的码', () => {
    // 只有码载荷里的 custodyOrderId 与本单一致才 DEL 旧码
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain(
      "tostring(pDecoded['custodyOrderId']) == orderId",
    );
    const guardIndex = ISSUE_PICKUP_CODE_REPLACING_LUA.indexOf(
      "tostring(pDecoded['custodyOrderId']) == orderId",
    );
    const deleteIndex = ISSUE_PICKUP_CODE_REPLACING_LUA.indexOf(
      "redis.call('DEL', previousKey)",
    );
    // DEL 必须作为归属判断的子语句出现在其后（缩进更深），而不是无条件执行
    expect(deleteIndex).toBeGreaterThan(guardIndex);
  });

  it('抢占新码与绑定存单发生在同一脚本内（SET 码键 + SET 绑定键）', () => {
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain(
      "if redis.call('EXISTS', codePrefix .. ARGV[index]) == 0 then",
    );
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain(
      "redis.call('SET', codePrefix .. picked, payload, 'EX', ttl)",
    );
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain(
      "redis.call('SET', orderKey, cjson.encode({ code = picked, expiresAt = expiresAt }), 'EX', ttl)",
    );
  });

  it('候选码耗尽（脚本返回 nil）时抛错，且先删掉绑定键不留悬空指针', async () => {
    evalMock.mockResolvedValue(null);

    await expect(
      service.issuePickupCodeReplacing(88, { custodyOrderId: 88, storeId: 7 }),
    ).rejects.toThrow('客存短码签发失败');
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(ISSUE_PICKUP_CODE_REPLACING_LUA).toContain(
      "redis.call('DEL', orderKey)",
    );
  });
});
