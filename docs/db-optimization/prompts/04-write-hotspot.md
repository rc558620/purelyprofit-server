# 上游结论摘要
<S1 摘要>

# 本轮输入：写路径盘点（文件:行号:内容）
<写路径清单：粘贴 inputs/02-write-paths.txt 全文>

# 本轮任务
只做写热点行锁竞争与大表膨胀治理。不做索引审计、不做读查询优化。

1. 写热点识别：结合上面的写路径清单，找出高频 UPDATE 的热点行，重点关注
   ScanOrders 状态流转、SpaceSession 续费与自动结账、库存扣减、
   会员积分/余额变动、StoreSubAccount 配额扣减。给出并发写冲突的具体场景推演。
2. 逐表评估行锁竞争、死锁风险、事务内热点行持有时间，对照
   TX_TIMEOUT_SHORT/MEDIUM/LONG (5s/15s/30s) 判断是否存在长事务持锁风险。
3. 表膨胀评估：按档 B/C 写入量估算 HOT 更新比例、autovacuum 能否跟上，
   给出每张热点表的 autovacuum 参数覆盖建议。
4. 分区/冷热分离判定：针对 sale_order_items、scan_orders、member_points_log、
   marketing_consumption、audit_logs，逐表判定「档 B 必须做 / 档 C 再做 / 不需要」，
   给出分区键建议（注意时区 Asia/Shanghai、DB 会话为 UTC）与不做分区的替代方案。

# 禁止输出
- 索引增删建议
- 读路径查询优化
- 任何与写入无关的内容

# 交付格式
表 1：写热点表清单（表 / 热点操作 / 并发冲突场景 / 锁风险等级）
表 2：autovacuum 参数覆盖建议（表 / 参数 / 值 / 依据）
表 3：分区/冷热分离判定表（表 / 档位判定 / 分区键 / 替代方案 / 风险）
+ 【S4 摘要】
