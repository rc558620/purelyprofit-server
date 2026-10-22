# 交接门禁模式（Handoff-Gate Mode）

> **一句话定义**：长任务按阶段开新窗口执行；每个窗口只读结构化交接包启动、只写结构化交接包退出；阶段间由人工依据证据放行，进度由不可变功能清单唯一判定。

---

## 0. 适用范围

本模式适用于需要多阶段执行、单阶段预计 15–60 分钟、且对准确性要求较高的任务，例如：

- 多文件代码改造与测试补齐
- 数据迁移与校验
- 文档/配置的分阶段生成与审查
- 需要多次调用工具链的工程任务

**不适用于**：一次性问答、无需跨窗口连续性的简单任务。

---

## 1. 核心原则

1. **交接是生成物，不是总结**：禁止让旧窗口“写一段总结”交给新窗口。交接包必须是固定字段的 JSON，由出口要求约束生成。
2. **进度只认功能清单**：`feature_list.json` 的 `passes` 字段是唯一进度真相；不接受“代码写完了”“差不多完成了”作为通过理由。
3. **一个窗口只推进一个 feature**：`next_action` 只允许指向一个 feature，禁止“顺便做别的”。
4. **证据门禁放行**：开下一个窗口前，人必须检查测试输出、diff/commit、文件存在性等证据；不接受模型自述。
5. **失败要写结论**：`failed_attempts` 必须写“为什么这条路不可行”，不能只写“报错了”，防止后续窗口重踩。
6. **交接链有深度上限**：连续开新窗口不宜超过 4 段；超过时先整合回中枢窗口做全局对齐，再继续分段。

---

## 2. 项目初始化

在项目根目录创建 `.handoff/` 目录，放入以下三个文件。任务开始前必须写好 `feature_list.json`，另外两个文件由每个窗口在出口时生成/覆盖。

### 2.1 `.handoff/feature_list.json` —— 不可变契约

```json
{
  "task_id": "<项目任务ID，例如 proj-2026-001>",
  "overall_goal": "<一句话描述整个任务要交付什么>",
  "features": [
    {
      "id": "feat-001",
      "description": "<可独立验证的最小功能单元>",
      "acceptance_steps": [
        "<步骤1：执行什么命令 / 检查什么输出>",
        "<步骤2：看到什么才算通过>"
      ],
      "passes": false
    }
  ]
}
```

**硬约束**：

- 任务开始后，任何窗口只能读该文件；只能把某个 feature 的 `passes` 从 `false` 翻为 `true`。
- 不得删除 feature，不得修改 `description` 或 `acceptance_steps`，不得把 feature 标记为“不适用”。
- `passes` 翻为 `true` 的前提是：该 feature 的 `acceptance_steps` **全部实际执行并通过**，且证据已落盘。

### 2.2 `.handoff/handoff_packet.json` —— 窗口出口工件

每个窗口在关闭前必须生成此文件。下一个窗口只读此文件启动，不读取上一窗口聊天记录。

```json
{
  "session_id": "session-<三位序号>",
  "goal_this_session": "<本段唯一目标，一句话>",
  "summary": "<本段实际完成了什么，不超过5句>",
  "changed_files": [
    "<path/to/file>"
  ],
  "commands_run": [
    {
      "cmd": "<实际执行的命令>",
      "exit_code": 0,
      "note": "<通过/失败说明>"
    }
  ],
  "failed_attempts": [
    {
      "what": "<尝试了什么>",
      "why_failed": "<失败原因，必须是因果解释而非报错复述>",
      "conclusion": "<不要再走这条路，除非什么条件改变>"
    }
  ],
  "open_risks": [
    {
      "risk": "<什么可能咬下一段>",
      "severity": "high",
      "mitigation": "<下一段必须做的检查或防范动作>"
    }
  ],
  "next_action": {
    "feature_id": "<feat-xxx，只允许一个>",
    "first_concrete_step": "<下一窗口打开后的第一个具体命令或动作>",
    "expected_evidence": "<什么输出/结果算这一步成功>"
  },
  "verdict_pointer": {
    "test_output": "<path/to/test_output.txt>",
    "diff_or_commit": "<git commit hash 或 diff 文件路径>",
    "review_note": "<人工审查记录路径，如无则写 none>"
  }
}
```

**字段规则**：

- `failed_attempts` 即使本段无失败尝试，也必须写空数组 `[]`。
- `next_action.feature_id` 必须且只能是一个 feature；出现“顺便看 feat-005”视为不合格交接。
- `next_action.first_concrete_step` 必须具体到可直接执行；写“继续优化”“完善剩余部分”视为不合格。
- `verdict_pointer` 必须指向真实存在的证据文件或 commit，不能只写“已通过”。

### 2.3 `.handoff/clean_state.json` —— 交接前门禁

每个窗口在生成 `handoff_packet.json` **之前**，必须先产出此文件。

```json
{
  "blocking_issues": [],
  "uncommitted_changes": "无 / 已提交 / 以下文件故意保留未提交：<列表>",
  "tests_runnable": true,
  "working_directory_clean": true
}
```

**硬约束**：`blocking_issues` 为空数组是允许生成交接包的前置断言。存在未解决阻塞时，不允许开新窗口；先在当前窗口处理，或回退到上一窗口处理。

---

## 3. 单个窗口的执行流程

### 3.1 启动：新窗口第一条消息

新窗口的第一条消息**不要**写“我们继续吧”或“接着上回做”。把下面这段作为唯一启动提示词投递（替换 `<N>` 和 `<任务名>`）：

```text
你是“<任务名>”的第 <N> 段执行者。你只负责一个阶段，不负责整个任务。

【启动输入】
1. 读取 .handoff/feature_list.json：只关注 passes=false 的条目。不得修改任何已有条目的 description 或 acceptance_steps，不得删除 feature。
2. 读取 .handoff/handoff_packet.json：从 next_action 开始工作。
3. 不要引用、推测或询问上一窗口的聊天记录；上一窗口的全部有效信息已在本交接包中。

【本段规则】
- 本段只推进 handoff_packet.next_action 指定的那一个 feature。
- 如果实际执行中发现 next_action 指向的 feature 无法按 acceptance_steps 完成，停止并报告，不要自行替换目标。
- 不得修改 feature_list.json 的 schema。
- 完成（或阻塞）后，按“出口要求”产出 clean_state.json 和 handoff_packet.json。

【出口要求】
- 只有当 acceptance_steps 全部实际执行并通过，才可将对应 feature 的 passes 翻为 true。
- 如果未完成，passes 保持 false，并在 next_action 中写明下一段从哪里继续。
- 必须填写 failed_attempts，即使本段没有失败尝试，写空列表 []。
- 必须先产出 clean_state.json；blocking_issues 不为空时，不得生成交接包。
```

### 3.2 执行中的检查点

- 每完成一个 `acceptance_step`，立即把命令输出重定向到文件落盘，不要等最后回忆。
- 连续执行超过 20 分钟，强制停下来增量写一次 `commands_run` 和 `failed_attempts`，防止后期回忆失真。
- 发现模型在“想太多”或偏离 `next_action`，直接打断，要求其回到启动提示词第一句重新对齐。

### 3.3 出口：生成两个文件

窗口结束前，必须按顺序：

1. 生成 `.handoff/clean_state.json`，确认 `blocking_issues` 为空。
2. 生成 `.handoff/handoff_packet.json`，确保所有字段完整、`next_action` 只指向一个 feature、证据指针真实存在。

---

## 4. 人工放行检查清单

在开下一个窗口之前，你必须完成以下三关检查。任何一关不通过，打回当前窗口重做出口工件，不得开新窗口。

### 第一关：干净状态

- [ ] `clean_state.json` 存在且 `blocking_issues` 为空数组
- [ ] `uncommitted_changes` 有明确说明（无 / 已提交 / 故意保留并列出）
- [ ] `tests_runnable` 为 `true`
- [ ] `working_directory_clean` 为 `true`

### 第二关：证据真实

- [ ] `verdict_pointer.test_output` 指向的文件真实存在，且内容与 `commands_run` 一致
- [ ] `verdict_pointer.diff_or_commit` 指向的 commit 或 diff 真实存在，改动范围与 `changed_files` 一致
- [ ] 如果 `passes` 被翻为 `true`，对应 feature 的 `acceptance_steps` 在证据中逐条可查
- [ ] 不接受“模型说通过了”作为证据

### 第三关：下一步可执行

- [ ] `next_action.feature_id` 只包含一个 feature
- [ ] `next_action.first_concrete_step` 具体到可直接执行（包含命令、文件路径或明确动作）
- [ ] `next_action.expected_evidence` 明确说明什么输出算成功
- [ ] `failed_attempts` 中每一条都有 `conclusion`，不是单纯报错复述

三关全部通过后，关闭当前窗口，用新的 `handoff_packet.json` 启动下一窗口。

---

## 5. 针对 DeepSeek 1017 的特别约束

在通用框架之上，追加以下硬约束：

1. **禁止叙述性摘要作为交接**：如果使用自动化插件，必须确认其输出为固定字段 JSON；只有“总结”模式而无 JSON 出口的插件不要用。
2. **交接链深度上限为 4 段**：超过 4 段时，把 `feature_list.json` 和累计的交接包历史整合回一个中枢窗口做全局对齐，再继续分段，不要无限接力。
3. **`failed_attempts` 必须写否决理由**：1017 在长链路中容易重踩旧坑，交接中只写“试了X失败”不够，必须写“因为Y约束，X在Z条件下不可行”。
4. **`next_action` 只允许一个 feature**：1017 有“顺手做别的事”和“过早宣布整体完成”的倾向，多目标 `next_action` 直接视为不合格交接。
5. **窗口内部设硬检查点**：每 20 分钟或每完成一个 acceptance_step 强制落盘增量记录，防止“执行幻觉”和后期回忆失真。

---

## 6. 端到端最小示例

任务：给 CLI 工具 `mytool` 添加 `export`、`import`、`validate` 三个子命令。

### 6.1 初始化 `feature_list.json`

```json
{
  "task_id": "cli-001",
  "overall_goal": "为 mytool 添加 export/import/validate 三个子命令",
  "features": [
    {
      "id": "f1",
      "description": "export 子命令将数据导出为 JSON",
      "acceptance_steps": [
        "执行 mytool export --out /tmp/x.json",
        "读取 /tmp/x.json 并确认包含 items 键"
      ],
      "passes": false
    },
    {
      "id": "f2",
      "description": "import 子命令从 JSON 导入数据",
      "acceptance_steps": [
        "执行 mytool import /tmp/x.json",
        "数据库中存在对应记录"
      ],
      "passes": false
    },
    {
      "id": "f3",
      "description": "validate 子命令校验 JSON schema",
      "acceptance_steps": [
        "执行 mytool validate /tmp/bad.json，返回非零退出并打印错误"
      ],
      "passes": false
    }
  ]
}
```

### 6.2 窗口 1 出口示例

`clean_state.json`：

```json
{
  "blocking_issues": [],
  "uncommitted_changes": "无",
  "tests_runnable": true,
  "working_directory_clean": true
}
```

`handoff_packet.json` 关键字段：

```json
{
  "session_id": "session-001",
  "goal_this_session": "实现 f1 export 子命令",
  "summary": "export 子命令已实现，acceptance_steps 两条均实际执行通过。",
  "changed_files": ["src/export.py", "tests/test_export.py"],
  "commands_run": [
    {"cmd": "mytool export --out /tmp/x.json", "exit_code": 0, "note": "生成文件成功"},
    {"cmd": "python -c \"import json;d=json.load(open('/tmp/x.json'));assert 'items' in d\"", "exit_code": 0, "note": "items 键存在"}
  ],
  "failed_attempts": [
    {
      "what": "最初尝试用 CSV 输出",
      "why_failed": "需求明确要求 JSON，CSV 不满足 acceptance_steps 第一条",
      "conclusion": "不要再用 CSV；除非需求变更"
    }
  ],
  "open_risks": [],
  "next_action": {
    "feature_id": "f2",
    "first_concrete_step": "读取 feature_list.json 中 f2 的 acceptance_steps，执行第一条命令 mytool import /tmp/x.json",
    "expected_evidence": "命令退出码为 0，且数据库查询返回对应记录"
  },
  "verdict_pointer": {
    "test_output": ".handoff/evidence/session-001-test.txt",
    "diff_or_commit": "abc1234",
    "review_note": "none"
  }
}
```

### 6.3 人工放行

你检查 `/tmp/x.json` 确实存在且包含 `items`，查看 `.handoff/evidence/session-001-test.txt` 与 `commands_run` 一致，确认 `next_action` 只指向 `f2` 且第一步具体可执行。三关通过后，开窗口 2，只投递启动提示词和 `.handoff/` 下的两个 JSON，不投递窗口 1 的聊天记录。

---

## 7. 快速复制包

将以下内容放入项目 `README.md` 或 `docs/handoff-gate-mode.md` 顶部：

```text
本项目采用“交接门禁模式（Handoff-Gate Mode）”执行长任务：
开新窗口 + 结构化交接。每个窗口只读 .handoff/handoff_packet.json 启动，
只写 .handoff/handoff_packet.json 退出；进度由 .handoff/feature_list.json
的 passes 字段唯一判定；交接由 .handoff/clean_state.json 的
blocking_issues 门禁放行。不接受叙述性摘要，不接受“模型说完成了”。
```

将第 2 节三个 JSON 模板复制到 `.handoff/` 目录，将第 3.1 节启动提示词保存为 `.handoff/start-prompt.txt`，将第 4 节检查清单保存为 `.handoff/release-checklist.md`。每个任务开始时，只改 `feature_list.json` 的 `task_id`、`overall_goal` 和 `features`，其余流程不变。