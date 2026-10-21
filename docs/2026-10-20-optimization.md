# 2026-10-20 purelyprofit-server 优化记录

> 范围：当日工作区未提交改动，仅记录优化过的模块。

| # | 模块 | 位置 |
|---|---|---|
| 1 | 数据库索引（迁移） | `prisma/migrations/` |
| 2 | 客存 custody | `src/shared/custody/`、`src/purely-club/custody/` |
| 3 | 扫码点单 scan-ordering（C 端）/ 营销定价 | `src/purely-club/scan-ordering/` |
| 4 | 扫码点单 scan-ordering（商家端：退款 / 拒单 / 状态流转） | `src/purely-profit/operations/scan-ordering/` |
| 5 | 库存与商品 | `src/purely-profit/goods/` |
| 6 | 销售记录 | `src/purely-profit/operations/sales-record/` |
| 7 | 空间管理 | `src/purely-profit/operations/spaces/` |
| 8 | Redis 基础设施（缓存键 / 失效 provider / 原子原语） | `src/redis/` |
| 9 | 会员等级 | `src/purely-club/member/member-levels/` |
| 10 | 交接班 handover | `src/purely-profit/operations/handover/` |
| 11 | 经营分析概览 dashboard-home | `src/purely-profit/dashboard/dashboard-home/` |
| 12 | 利润详情 profit-detail | `src/purely-profit/dashboard/profit-detail/` |
| 13 | 经营分析 business-analysis | `src/purely-profit/dashboard/business-analysis/` |
| 14 | 营销中心 | `src/purely-profit/marketing/` |
| 15 | 营销短信 sms | `src/purely-profit/marketing/sms/` |
| 16 | 营销相关索引 | `prisma/migrations/20261020150000`、`20261020160000` |
