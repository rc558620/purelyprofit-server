# 交接门禁模式（Handoff-Gate Mode）· v2

> **一句话定义**：长任务按阶段开新窗口执行；每个窗口只读结构化交接包启动、只写结构化交接包退出；**是否通过由脚本执行命令判定，模型只允许自评**；进度由不可变功能清单唯一判定。

---

## 快速上手（三分钟）

整个流程只有三个动作：**说一句话 → 看一眼契约 → 复制粘贴循环**。

### 第 1 步：让 AI 建契约

在新会话里说：

```text
用 handoff-gate-mode 完成这个需求：
<贴需求>

先按 docs/docs/handoff-gate-mode.md 的 v2 规范产出 .handoff/feature_list.json
（features / acceptance_steps / allowed_paths / invariants），执行 init 写好文件后停下来，
把契约内容贴给我确认。不要 seal，不要写业务代码。
```

### 第 2 步：确认契约

AI 会贴出每个 feature 的描述、验收命令、改动白名单、全局回归命令。你只看三件事：

- 验收命令能不能直接粘到终端跑？（写“确认正常”的一律打回）
- `allowed_paths` 是不是窄到能挡住越界？**不要让它写 `**`**
- `invariants` 是不是全量回归，而不是某个模块的测试？

确认后回一句：

```text
确认，执行 seal，然后执行 next 把第一段提示词给我
```

### 第 3 步：复制粘贴循环

| 你做什么 | 得到什么 |
| --- | --- |
| 新建会话，粘贴上一段给的提示词 | AI 开始实现这一段的 feature |
| 等它说完成 | 它跑 `finish`，打印出下一段提示词 |
| 复制那段提示词，新建会话粘贴 | 进入下一段 |

重复到输出 `🎉 所有 feature 均已通过，任务完成` 为止。

### 你唯一需要主动检查的

每段结束时瞄一眼 `.handoff/release-report.txt` 的结论行：`PASS` 才继续，`BLOCK` 就地修。

> 提示词永远由脚本生成（`next` / `finish`），不是模型写的。模型若自行编造提示词，直接打断并要求它跑命令。

---

## 0. 与 v1 的关键差异

| 维度 | v1（旧） | v2（本版） |
| --- | --- | --- |
| 谁判定通过 | 模型自述 + 人工看 | `run` 子命令执行命令看退出码 |
| `passes` 谁翻 | 任何窗口都能翻 | 只有脚本能翻，模型只能写 `candidate_pass` |
| 证据谁生成 | 模型写文件 | 脚本创建并写签名头，事后改动即 hash 失配 |
| 回归保护 | 无 | `invariants` 全量门禁，每段出口必跑 |
| 越界改动 | 事后清单 | `allowed_paths` 白名单，越界直接拒 |
| 跨段定位 | 只有 feature_id | `cursor.done_steps` / `next_step_index` 步级游标 |
| 卡住处理 | 无定义 | `attempt_count` 触发换策略 / 回中枢拆 feature |
| 契约防篡改 | 靠自觉 | `feature_list.lock` hash 锁 |
| 人工成本 | 三关逐项核对 | 读 30 行 `release-report.txt` + 抽查 1 处 |
| 下一窗口提示词 | 人工复制模板、替换 `<N>` | 脚本 `next` / `finish` 自动生成，整段复制 |
| `clean_state` 谁写 | 模型声明 | 脚本按固定口径生成，不靠自称 |

**执行底座**：`scripts/handoff-verify.mjs` + `scripts/lib/handoff-core.mjs`。

---

## 1. 适用范围

适用于多阶段、单阶段 15–60 分钟、准确性要求高的任务：多文件改造与测试补齐、数据迁移与校验、分阶段文档生成、需要多次工具调用的工程任务。

**不适用于**一次性问答与无需跨窗口连续性的简单任务。

---

## 2. 核心原则

1. **通过与否是执行结果，不是描述**：`passes` 由脚本在执行 `acceptance_steps` 命令并核对退出码后翻转。模型只能写 `candidate_pass: true` 表示“我认为可以了”，这个字段不参与任何判定。
2. **验收步骤必须是可执行命令**：`acceptance_steps[].cmd` 必须能直接交给 shell 执行，退出码达标才算通过。凡是想写“检查一下是否正常”的，必须包装成断言命令（`grep -q`、`node -e 'assert(...)'`、`test -f` 等）。
3. **进度只认功能清单 + 游标**：`feature_list.json` 的 `passes` 与 `handoff_packet.json` 的 `cursor` 合起来才是进度真相，不接受“代码写完了”。
4. **一个窗口只推进一个 feature 的一段步骤**：`cursor.feature_id` 只允许一个，`next_action` 不得出现第二个目标。
5. **每段必须跑全局回归**：`invariants` 是“不许弄坏什么”的基线，长链最常见的失准就是后段破坏前段。
6. **改动不许越界**：本段相对基线快照的实际改动必须落在当前 feature 的 `allowed_paths` 内，越界即拒绝交接。**本模式不执行任何 `git` 命令**，版本提交、分支管理由使用者自行负责。
7. **失败要写因果**：`failed_attempts[].conclusion` 必须是“因为 Y 约束，X 在 Z 条件下不可行”，不能只写“报错了”。
8. **下一步不由任何窗口创作**：执行窗口只产出事实（证据、游标、失败原因）；`next_action` 的取值被**契约顺序机械决定**（见 6.1），中枢窗口只在跳序、拆 feature、4 段对齐时介入。上一段跑偏的状态无法沿链条获得授权。
9. **链深上限 4 段**：超过必须回中枢对齐，禁止无限接力。

---

## 3. 文件职责

`.handoff/` 下各文件由谁写，是这套机制能否生效的关键。

| 文件 | 写者 | 说明 |
| --- | --- | --- |
| `feature_list.json` | 人（首次） | 契约。`description` / `acceptance_steps` / `allowed_paths` 一经 seal 不可改 |
| `feature_list.lock` | `seal` 子命令 | 契约 hash，用于识别任何窗口的偷改 |
| `handoff_packet.json` | 执行窗口写事实（`failed_attempts` / `open_risks`）；`next_action` 与 `cursor` 由脚本回填 | 窗口出口工件 |
| `clean_state.json` | 仅 `finish` 子命令 | 出口门禁，不靠模型自称；不读取 git 状态 |
| `baseline.json` | 仅 `seal` 与 `finish` 子命令 | 文件快照基线（路径 → 大小 + 修改时间），用于判定本段是否越界 |
| `verify_state.json` | 仅 `run` 子命令 | 签名记录，模型不得手写；它是“谁被证明通过”的唯一依据 |
| `evidence/*.txt` | 仅脚本 | 每份带签名头，模型手写的证据一律被识别为伪造 |

> `.handoff/evidence/` 与 `verify_state.json` 建议提交入库或单独备份，它们是回溯的唯一凭据。

---

## 4. 初始化（只在任务开始时做一次）

```bash
node scripts/handoff-verify.mjs init <task_id> "<overall_goal>"
```

生成骨架后，人工补全 `feature_list.json`，然后**封存契约**：

```bash
node scripts/handoff-verify.mjs seal
```

`seal` 之后任何窗口改动 `description` / `acceptance_steps` / `allowed_paths` 都会被 `check` 拦下。确需变更契约时，由人删掉 `feature_list.lock` 重新 `seal`，并在 `failed_attempts` 里记录变更原因——**变更必须留痕**。

### 4.1 `feature_list.json` 结构

```json
{
  "task_id": "cli-001",
  "overall_goal": "为 mytool 添加 export/import/validate 三个子命令",
  "invariants": [
    { "id": "inv-typecheck", "cmd": "pnpm typecheck", "expect_exit": 0 },
    { "id": "inv-test", "cmd": "pnpm test", "expect_exit": 0 }
  ],
  "features": [
    {
      "id": "feat-001",
      "description": "export 子命令将数据导出为 JSON",
      "allowed_paths": ["src/export/**", "tests/export/**"],
      "acceptance_steps": [
        { "cmd": "mytool export --out /tmp/x.json", "expect_exit": 0 },
        { "cmd": "test -f /tmp/x.json && node -e \"const d=require('/tmp/x.json');if(!d.items)process.exit(1)\"", "expect_exit": 0 }
      ],
      "candidate_pass": false,
      "passes": false
    }
  ]
}
```

**硬约束**：

- `acceptance_steps` 每一项必须是对象 `{ "cmd": "...", "expect_exit": 0 }`，`expect_exit` 缺省为 0。写成字符串会被 `seal` 直接拒绝——验收判定必须显式，混合形态会让契约 hash 失去意义。
- `cmd` 必须是可直接交给 shell 执行的命令；凡是想写“检查一下是否正常”的，必须包装成断言（`grep -q`、`test -f`、`node -e 'assert(...)'`）。
- `allowed_paths` 必填，支持 `*` 与 `**` 通配；写 `**` 等于放弃越界保护。
- `invariants` 至少一条，且必须是**全量**回归命令，不是本 feature 的局部测试。
- 不得删除 feature，不得事后把 feature 标记为“不适用”。

---

## 5. 单个窗口的执行流程

### 5.1 窗口启动：粘贴脚本给的提示词（不要自己写）

启动提示词一律由脚本生成，**不要手写，也不要让模型自己编**。

```bash
node scripts/handoff-verify.mjs next     # 第一段：seal 之后执行一次
```

命令直接打印一段完整提示词，同时存到 `.handoff/next-prompt.txt`。**整段复制，粘到新会话的第一条消息**。

提示词里的第几段、做哪个 feature、剩余验收命令、改动白名单，全部从契约派生，没有任何模型自由发挥的空间。形态如下：

```text
<模式文档绝对路径>

按上面这份交接门禁模式（v2）规范执行。你是「cli-001」的第 2 段执行者，只负责一个阶段。

【本段目标】
feature: feat-002 — import 子命令从 JSON 导入数据
改动白名单：src/import/**, tests/import/**
剩余验收步骤：
  [0] mytool import /tmp/x.json
  [1] psql -tAc "select count(*) from items" | grep -qx 3

【启动输入】...
【本段规则】...
【收尾】实现完成后只执行一条命令：node scripts/handoff-verify.mjs finish
```

### 5.2 窗口执行：只管写代码

- 只推进提示词里指定的那个 feature，不换目标、不扩大改动范围。
- 需要改白名单外的文件时，停下来报告，不要自行扩大。
- 每条 `acceptance_step` 都由 `run` 落盘，禁止另存或改写证据。
- 连续执行超过 20 分钟，先跑一次 `finish` 看看当前状态，比闷头写完再验证更省事。

### 5.3 窗口收尾：一条命令搞定

```bash
node scripts/handoff-verify.mjs finish
```

它内部按顺序完成：

1. `run` — 真实执行 `acceptance_steps`，全绿才翻 `passes`
2. 自动回填 `next_action`（指向契约顺序中最靠前的待办 feature）
3. `gate` — 跑全局 `invariants` 回归门禁
4. 自动生成 `clean_state.json`（固定口径，不读 git 状态）
5. `check` — 全量校验，生成 `release-report.txt`
6. **打印下一窗口的提示词**

全部通过时，把打印出来的提示词原样复制到新会话即可。任何一步失败都会停下并指出原因——此时**不要开新窗口**，就地修。

### 5.4 失败后必须换窗口时

```bash
node scripts/handoff-verify.mjs next
```

输出「继续本段」的提示词：段号不前进，`cursor` 从上次失败的那一步接着做，`attempt_count` 保留累计值。

> 分步命令 `run` / `gate` / `check` 仍然保留，用于排错时单独调用；日常流程只用 `next` 和 `finish`。

---

## 6. `handoff_packet.json` 结构

```json
{
  "session_id": "session-002",
  "segment_index": 2,
  "parent_session_id": "session-001",
  "goal_this_session": "实现 feat-002 import 子命令",
  "changed_files": ["src/import/import.ts", "tests/import/import.spec.ts"],
  "commands_run": [
    { "cmd": "node scripts/handoff-verify.mjs run", "exit_code": 0, "note": "2 步全部达标" }
  ],
  "failed_attempts": [
    {
      "what": "最初直接用 JSON.parse 读整文件",
      "why_failed": "acceptance_steps 要求大文件流式读取，整文件解析在 512MB 用例下 OOM",
      "conclusion": "不要再用整文件解析；除非输入规模上限被写进契约"
    }
  ],
  "open_risks": [
    { "risk": "旧数据含 BOM 头", "severity": "high", "mitigation": "feat-003 前先跑 BOM 样本用例" }
  ],
  "attempt_count": 0,
  "cursor": {
    "feature_id": "feat-002",
    "done_steps": [0, 1],
    "next_step_index": 2
  },
  "next_action": {
    "feature_id": "feat-003",
    "first_concrete_step": "执行 node scripts/handoff-verify.mjs run（cursor 已指向 feat-003 第 0 步）",
    "expected_evidence": "run 退出码 0，evidence/session-003-feat-003-step-0.txt 出现"
  },
  "verdict_pointer": {
    "test_output": ".handoff/evidence/session-002-feat-002-step-1.txt",
    "gate_output": ".handoff/evidence/session-002-gate.txt",
    "diff_or_commit": "none"
  }
}
```

**字段规则**：

- 删除了 v1 的 `summary` 自由文本。语义传递改由 `cursor` + `failed_attempts` + `open_risks` 承担，避免“最关键的意图放在最不受约束的字段里”。
- `session_id` 必须与 `segment_index` 对齐（`session-002` ↔ 2），脚本会校验。
- `failed_attempts` 无失败也必须写 `[]`。
- `next_action.feature_id` 必须是单个字符串，且**取值由契约顺序唯一决定**，见 6.1。
- `first_concrete_step` 出现“继续 / 完善 / 优化 / 推进 / 剩余部分”等含糊表述会被脚本直接拦下。
- `verdict_pointer` 的 `test_output` / `gate_output` 必须指向脚本生成的真实证据文件；`diff_or_commit` 由使用者自行填写或无值，脚本不做任何 commit 校验。

### 6.1 `cursor` 与 `next_action` 的分工（脚本强制）

- `cursor` 表示**本段正在做**的 feature，其 `done_steps` / `next_step_index` 是步级进度，只由 `run` 推进。
- `next_action` 表示**下一段做**的 feature，取值被契约顺序唯一决定：

| 当前状态 | `next_action.feature_id` 必须为 |
| --- | --- |
| `cursor` 指向的 feature 尚未通过 | 同一个 feature（本段没做完，下段继续） |
| 该 feature 已通过，且仍有待办 | 契约顺序中**最靠前**的待办 feature |
| 所有 feature 均已通过 | `"none"` |

跳序在脚本层不被允许；确需跳序属于契约变更，走“删 `feature_list.lock` → 人工改 `features` 顺序 → 重新 `seal`”的流程，并留痕。

下段启动执行 `run` 时，脚本检测到 `next_action` 已指向新 feature 且旧 cursor 已通过，会**自动把 cursor 推进过去**并输出 `→ 游标推进到 feat-xxx`，不需要人工改 cursor。

---

## 7. 人工放行（成本已被压到最低）

不再逐项核对三关，改为：

1. 打开 `.handoff/release-report.txt`（脚本生成，≤30 行），确认首行结论为 `PASS`。
2. 抽查一处：从报告的 `[改动白名单]` 里挑一个文件看 diff，确认改动确实是这个 feature 该做的事。
3. 确认 `BLOCK` 计数为 0 且没有任何一条 `[自述通过]` / `[越界]` / `[证据漂移]` 残留。

不通过就**在当前窗口修**，不许开新窗口。

> 人的职责从“验证正确性”收缩为“验证目标正确性”——机械部分已交给脚本。

---

## 8. 中枢对齐与失败升级

### 8.1 每 4 段必回中枢

`segment_index > 4` 时脚本直接拒绝交接。中枢窗口必须：

1. 用新鲜上下文读 `feature_list.json` + 最近 4 段的 packet；
2. 跑一次 `gate` 确认全局基线；
3. 产出 `.handoff/alignment.json`：`{ "verified_features": [...], "regressions": [...], "contract_changes": [...] }`；
4. 重写 `next_action` 与 `cursor`，链深归零重新计数。

### 8.2 失败升级

`attempt_count` 由 `run` 自动递增，规则：

| 次数 | 必须动作 |
| --- | --- |
| 1 | 正常运行，`failed_attempts` 写清因果 |
| ≥2 | 脚本强制校验 `conclusion` 必须是根因分析，禁止“报错了”这类复述；必须**换策略**，不得原样重试 |
| ≥3 | 脚本直接拒绝原样重开窗口，**必须回中枢拆 feature**（把一条 acceptance_step 拆成独立 feature） |

---

## 9. 针对长链模型的追加约束

1. **禁止叙述性摘要作为交接**：任何交接信息必须是固定字段 JSON，`summary` 类字段已从 schema 移除。
2. **禁止多目标也禁止挑目标**：`cursor.feature_id` 单一，`next_action` 单一且必须等于契约顺序中最靠前的待办 feature，多目标或跳序直接判不合格。
3. **禁止手工造证据**：`.handoff/evidence/` 只允许脚本写入；首行签名头缺失即判伪造。
4. **禁止跨段继承乐观判断**：上一段的 `candidate_pass` 不影响任何判定，唯一判据是 `verify_state.json` 的签名。
5. **窗口内硬检查点**：每 20 分钟或每完成一个 acceptance_step 落盘一次事实。

---

## 10. 端到端最小示例

```bash
# 0. 初始化与封存契约（只在任务开始时做一次）
node scripts/handoff-verify.mjs init cli-001 "为 mytool 添加 export/import/validate"
# 人工补全 feature_list.json（allowed_paths / acceptance_steps / invariants）
node scripts/handoff-verify.mjs seal
node scripts/handoff-verify.mjs next    # 打印第 1 段提示词 → 粘贴到新会话

# 1. 窗口 1 内：实现 feat-001 后
node scripts/handoff-verify.mjs finish
#   ✓ feat-001 第 0 步通过
#   ✓ feat-001 第 1 步通过 → passes 翻 true
#   ✅ 回归门禁全绿
#   ✅ 交接校验通过
#   ===== 下一窗口提示词（复制到新会话）=====
#   ...

# 2. 窗口 2 内：实现 feat-002 后
node scripts/handoff-verify.mjs finish
#   → 游标推进到 feat-002
#   🎉 所有 feature 均已通过，任务完成，不需要下一个窗口
```

`clean_state.json` 无需手写，`finish` 会按固定口径生成（不读 git）：

```json
{
  "blocking_issues": [],
  "uncommitted_changes": "由使用者自行管理（本模式不执行 git 操作）",
  "tests_runnable": true,
  "working_directory_clean": true
}
```

### 10.1 典型拦截输出

```text
   - [自述通过] feat-001.passes=true 但无脚本签名；passes 只能由 run 子命令翻转
   - [证据漂移] .handoff/evidence/session-001-feat-001-step-0.txt 在签名后被改动
   - [越界] b.txt 不在 feat-001.allowed_paths 内，越界改动禁止交接
   - [契约] feature_list 的 description / acceptance_steps / allowed_paths 被改动过
   - [失败升级] 同一 feature 已累计 3 次失败，禁止原样重开窗口；必须回中枢拆 feature
   - [深度] 第 6 段超过上限 4，必须先回中枢做全局对齐
```

---

## 11. 已知边界

- 脚本防的是**幻觉与偷懒**（说通过了其实没跑、改了别处、跳过步骤），不防**主动伪造**。若模型被要求逐字节复刻签名头，脚本无法识别。
- `allowed_paths` 写 `**` 时越界保护失效，等于放弃第 6 条原则。
- `invariants` 若只写局部测试，回归保护同样失效——这是本模式最容易被自己绕开的地方。
- 越界检测基于文件快照（相对路径 + 大小 + 修改时间），**不读取 git**；若文件被改动后大小与时间戳均未变化（极端情况），快照无法识别该改动。
- 本模式与 `f0rest_backend_conventions.md` 的 mode 路由表是两套体系：mode 决定“怎么写”，本模式决定“怎么跨窗口交付”。二者可叠加使用，不要混为一谈。

---

## 12. 快速复制包

```text
本项目采用“交接门禁模式（Handoff-Gate Mode）”执行长任务：
每个窗口由脚本生成的提示词启动（node scripts/handoff-verify.mjs next），
实现完成后跑一条 node scripts/handoff-verify.mjs finish 收尾，
它依次执行 run / gate / check 并打印下一窗口提示词。
passes 只能由 run 翻转，证据只能由脚本生成，改动不得越过 allowed_paths，
全程不执行 git 命令，版本提交由使用者自行管理；clean_state 按固定口径生成。
不接受叙述性摘要，不接受“模型说完成了”。
```
