# 数据库优化 Prompt 资产包

用于把「提升数据库日活支撑量」这件事拆成 **9 轮独立调用**，每轮只做一件事，避免单次输出过长、上下文膨胀。

## 目录结构

```
docs/db-optimization/
├─ README.md                    本文件：目录说明与依赖关系
├─ 跟着做.md                    傻瓜式 17 次粘贴操作手册（干活时开这个）
├─ notes.md                     摘要落盘处，每轮的 S{n} 摘要存这里
├─ prompts/                     源文件，可直接编辑
│  ├─ preamble.md               前置块（每轮都粘，内容不变）
│  ├─ 01-capacity.md            调用 1：容量建模
│  ├─ 02-server-pg-tuning.md    调用 2：服务器 / PG 参数基线
│  ├─ 03-index-audit.md         调用 3：索引结构审计
│  ├─ 04-write-hotspot.md       调用 4：写热点与大表治理
│  ├─ 05-query-degradation.md   调用 5：退化查询与 N+1
│  ├─ 06-tx-connection.md       调用 6：连接与事务边界
│  ├─ 07-idempotency-audit-log.md  调用 7：幂等与审计表增长
│  ├─ 08-module-template.md     调用 8：模块级优化（模板，每模块一次）
│  └─ 09-verify-launch.md       调用 9：验证、压测与上线清单
├─ inputs/                      脚本生成的输入清单（供调用 3、4、6 粘贴）
├─ assembled/                   脚本拼接好的完整 Prompt（直接全选复制即可）
└─ 实施/                         ★ 实施阶段（分析跑完后才用）
   ├─ 跟着做.md                 8 批实施操作手册
   ├─ notes.md                  实施阶段的 I1~I8 摘要落盘处
   ├─ prompts/                  实施任务卡源文件
   └─ assembled/                实施阶段拼好的完整 Prompt（8 个）
```

> **两个阶段的关系**：`docs/db-optimization/` 下这一层是**分析阶段**（只出方案，不改代码）；
> `实施/` 是**落地阶段**（真正改文件、出迁移）。分析阶段的结论是实施阶段的输入。

## 生成产物

```bash
cd <purelyprofit-server 根目录>
bash scripts/db-optimization-pack.sh
```

跑完会得到：

- `inputs/01-index-inventory.txt` —— 约 304 条索引声明，给调用 3
- `inputs/02-write-paths.txt` —— operations + member 的写路径，给调用 4
- `inputs/03-transactions.txt` —— 约 128 处 `$transaction`，给调用 6
- `assembled/*.full.md` —— 共 17 个文件（8 张独立任务卡 + 9 个模块变体），每个都是「前置块 + 任务卡」拼好的完整版，打开即可全选复制

单独重跑某一半：

```bash
bash scripts/db-optimization-pack.sh inputs     # 只更新输入清单
bash scripts/db-optimization-pack.sh assemble   # 只重新拼接 Prompt
```

## 喂给 AI 的流程

每一轮都是**同一个三步动作**：

1. 打开 `assembled/` 下对应的 `*.full.md`，**全选复制**
2. 粘贴给 AI
3. 把卡内 `<...>` 占位替换成实际内容（见下表）

| 轮次 | 用哪个文件 | 需要额外替换的占位 | 来源 |
|---|---|---|---|
| 1 | `assembled/01-capacity.full.md` | 无 | — |
| 2 | `assembled/02-server-pg-tuning.full.md` | `<S1 摘要>` | `notes.md` |
| 3 | `assembled/03-index-audit.full.md` | `<S1 摘要>`、`<索引清单>` | `notes.md`、`inputs/01-index-inventory.txt` |
| 4 | `assembled/04-write-hotspot.full.md` | `<S1 摘要>`、`<写路径清单>` | `notes.md`、`inputs/02-write-paths.txt` |
| 5 | `assembled/05-query-degradation.full.md` | `<S1 摘要>` | `notes.md` |
| 6 | `assembled/06-tx-connection.full.md` | `<S1 摘要>`、`<S2 摘要>`、`<事务清单>` | `notes.md`、`inputs/03-transactions.txt` |
| 7 | `assembled/07-idempotency-audit-log.full.md` | `<S1 摘要>`、`<S4 摘要>` | `notes.md` |
| 8 | `assembled/08-module-<模块名>.full.md` | `<S3 摘要>`、`<S4 摘要>`、`<S5 摘要>` | `notes.md` |
| 9 | `assembled/09-verify-launch.full.md` | 全部摘要 | `notes.md` |

**每轮结束后**：摘要会落到 `notes.md` 对应小节。

- 用 **IDE 里的 Agent**（有文件读写权限，如 CodeBuddy）：卡里已内置「文件操作」指令，它会**自动替换写入** `notes.md`，你零操作。首次跑完建议打开文件扫一眼确认位置对不对。
- 用 **网页版 AI**（无文件权限）：它会忽略该指令，你需要手动把输出末尾的 `【S{n} 摘要】` 复制进 `notes.md`。

> 内置指令用的是「替换」语义，重复跑同一轮不会在文件里堆出两份摘要。

## 执行顺序与依赖

```
S1 ──┬─→ 调用 2 ──┐
     ├─→ 调用 3 ──┼─→ 调用 8（每模块一次）──┐
     ├─→ 调用 4 ──┘                        ├─→ 调用 9
     ├─→ 调用 5 ────────────────────────────┘
     └─→ 调用 6
         └─→ 调用 7
```

- 调用 2、3、4、5 只依赖 S1，**可以并行**，但要**分开窗口**，不要在同一轮对话里混做。
- 调用 8 每换一个模块**新开一轮对话**，不要在同一个窗口连做 9 个模块。
- 模块顺序建议：`operations` → `member` → `marketing` → `finance` → `goods` → `staff` → `stores` → `club` → `pulse`。

## 三条纪律

1. **调用 3 严禁提新增索引**。卡里已写明禁止，AI 若越界，回一句「本轮不谈新增索引，删除该部分」再继续。
2. **摘要不许复制全文**。超过 15 行就回一句「摘要超过 15 行，压缩到只保留新增结论和硬约束」。
3. **上下文只带摘要**。不要在新窗口里粘贴上一轮的完整报告，否则上下文会线性膨胀，第 5 轮之后就会失焦。
