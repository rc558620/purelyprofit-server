// 客存取件码「换码」原子脚本（Redis Lua）
//
// 单独成文件便于脚本审阅与单测比对；执行入口仍是 CustodyCodeService。

/**
 * 「换码」原子脚本：解绑旧码 → 作废旧码 → 抢占新码 → 绑定存单，一次 RTT 完成。
 *
 * 为什么必须原子：原实现是 read → cancel → issue → bind 四次独立往返，
 * 中间任何一次失败/并发都会留下「绑定指向已删除码」或「旧码仍可核销」的残留；
 * 会员连点两次按钮时，两条链路交错还可能把 A 的码绑到 B 的存单上。
 *
 * 两条边界都在脚本里判定：
 * 1. **旧码不存在**（首次出码 / 绑定已过期）：跳过清理，直接签发；
 * 2. **旧码归属他人**：只有码载荷里的 custodyOrderId 与本单一致才 DEL，
 *    否则只丢弃绑定指针，绝不删除别人的码（覆盖签发 + 并发交错都可能出现）。
 *
 * 候选码在 Node 侧生成后整体传入，脚本内用 `EXISTS` 逐个尝试写入，
 * 既避免在 Lua 里用随机数（复制语义上不安全），也保证仍是一次往返。
 */
export const ISSUE_PICKUP_CODE_REPLACING_LUA = `
local orderKey = KEYS[1]
local codePrefix = ARGV[1]
local orderId = ARGV[2]
local payload = ARGV[3]
local expiresAt = ARGV[4]
local ttl = tonumber(ARGV[5])

local previous = redis.call('GET', orderKey)
if previous then
  local ok, decoded = pcall(cjson.decode, previous)
  if ok and type(decoded) == 'table' and decoded['code'] then
    local previousKey = codePrefix .. decoded['code']
    local rawPrevious = redis.call('GET', previousKey)
    if rawPrevious then
      local pOk, pDecoded = pcall(cjson.decode, rawPrevious)
      if pOk and type(pDecoded) == 'table'
        and tostring(pDecoded['custodyOrderId']) == orderId then
        redis.call('DEL', previousKey)
      end
    end
  end
end

local picked = nil
for index = 6, #ARGV do
  if redis.call('EXISTS', codePrefix .. ARGV[index]) == 0 then
    picked = ARGV[index]
    break
  end
end

if not picked then
  redis.call('DEL', orderKey)
  return nil
end

redis.call('SET', codePrefix .. picked, payload, 'EX', ttl)
redis.call('SET', orderKey, cjson.encode({ code = picked, expiresAt = expiresAt }), 'EX', ttl)
return picked
`;
