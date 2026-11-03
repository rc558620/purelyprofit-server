import fs from 'fs';
import path from 'path';
import {
  DIR,
  EVIDENCE_DIR,
  F_CLEAN,
  F_FEATURES,
  F_LOCK,
  F_PACKET,
  F_PROMPT,
  F_SIGNED,
  ROOT,
  contractHash,
  evidenceHeader,
  normalizeStep,
  readJson,
  sh,
  shapeFeature,
  syncNextAction,
  validate,
  writeCleanState,
  writeEvidence,
  writeBaseline,
  writeJson,
  writeReport,
} from './lib/handoff-core.mjs';
import { buildPrompt } from './lib/handoff-prompt.mjs';

/**
 * Handoff-Gate 命令行入口（交接门禁模式的执行底座）
 *
 * 用法：
 *   node scripts/handoff-verify.mjs init <task_id> "<overall_goal>"   # 生成 .handoff 骨架
 *   node scripts/handoff-verify.mjs seal                              # 封存 feature_list 契约
 *   node scripts/handoff-verify.mjs run                               # 执行未完成的 acceptance_steps
 *   node scripts/handoff-verify.mjs gate                              # 执行全局 invariants 回归门禁
 *   node scripts/handoff-verify.mjs check                             # 出口校验 + 生成 release-report.txt
 */

const rel = (target) => path.relative(ROOT, target);

const printBlocked = (ctx) => {
  ctx.errors.forEach((item) => console.error(`   - ${item}`));
  ctx.warnings.forEach((item) => console.warn(`   ⚠ ${item}`));
  console.error(`\n❌ 交接被拦截，详见 ${rel(writeReport(ctx))}`);
};

const cmdInit = () => {
  const taskId = process.argv[3];
  const goal = process.argv[4];
  if (!taskId || !goal) {
    console.error('用法：node scripts/handoff-verify.mjs init <task_id> "<overall_goal>"');
    process.exit(1);
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const features = {
    task_id: taskId,
    overall_goal: goal,
    invariants: [
      { id: 'inv-typecheck', cmd: 'pnpm typecheck', expect_exit: 0 },
      { id: 'inv-test', cmd: 'pnpm test', expect_exit: 0 },
    ],
    features: [
      {
        id: 'feat-001',
        description: '把要交付的最小可验证单元写在这里',
        allowed_paths: ['src/**'],
        acceptance_steps: [{ cmd: 'pnpm typecheck', expect_exit: 0 }],
        candidate_pass: false,
        passes: false,
      },
    ],
  };
  writeJson(F_FEATURES, features);
  writeJson(F_PACKET, {
    session_id: 'session-001',
    segment_index: 1,
    parent_session_id: 'none',
    goal_this_session: '首个窗口目标',
    changed_files: [],
    commands_run: [],
    failed_attempts: [],
    open_risks: [],
    attempt_count: 0,
    cursor: { feature_id: 'feat-001', done_steps: [], next_step_index: 0 },
    next_action: {
      feature_id: 'feat-001',
      first_concrete_step: '执行 pnpm typecheck 并落盘输出',
      expected_evidence: '退出码 0 且无类型错误',
    },
    verdict_pointer: { test_output: 'none', gate_output: 'none', diff_or_commit: 'none' },
  });
  writeJson(F_CLEAN, {
    blocking_issues: [],
    uncommitted_changes: '无',
    tests_runnable: true,
    working_directory_clean: true,
  });
  console.log('✅ .handoff/ 骨架已生成。补全 features 与 invariants 后：seal 封存契约 → next 取第一段提示词');
};

const cmdSeal = () => {
  const features = readJson(F_FEATURES);
  if (!features) {
    console.error('❌ 缺少 .handoff/feature_list.json，无法封存契约');
    process.exit(1);
  }
  if (!Array.isArray(features.features) || features.features.length === 0) {
    console.error('❌ features 为空，禁止封存空契约');
    process.exit(1);
  }
  const malformed = [];
  features.features.forEach((item) => {
    (item?.acceptance_steps ?? []).forEach((step, idx) => {
      if (typeof step === 'string') {
        malformed.push(`${item?.id} 第 ${idx} 步是字符串，必须写成 { "cmd": "...", "expect_exit": 0 }`);
      } else if (!String(step?.cmd ?? '').trim()) {
        malformed.push(`${item?.id} 第 ${idx} 步的 cmd 为空`);
      }
    });
  });
  if (malformed.length) {
    console.error('❌ 契约不合法，拒绝封存：');
    malformed.forEach((item) => console.error(`   - ${item}`));
    process.exit(1);
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(F_LOCK, `${contractHash(features)}\n`, 'utf-8');
  const sealedPacket = readJson(F_PACKET);
  writeBaseline(sealedPacket?.session_id ?? 'session-001');
  console.log('✅ 契约已封存。之后任何窗口改动 description / acceptance_steps / allowed_paths 都会被 check 拦下。');
  console.log('✅ 已记录文件基线：本段改动据此判定越界，全程不执行 git 操作。');
  console.log('   确需变更契约时，由人删除 .handoff/feature_list.lock 重新 seal，并在 failed_attempts 记录变更原因。');
};

const cmdRun = () => {
  const precheck = validate('pre');
  if (precheck.errors.length) {
    printBlocked(precheck);
    console.error('❌ 前置校验未通过，拒绝执行步骤');
    process.exit(1);
  }
  const features = readJson(F_FEATURES);
  const packet = readJson(F_PACKET);
  const signed = readJson(F_SIGNED) ?? {};
  const nextId = packet.next_action?.feature_id;
  const cursorFeature = (features.features ?? []).map(shapeFeature).find((item) => item.id === packet.cursor.feature_id);
  if (nextId && nextId !== 'none' && nextId !== packet.cursor.feature_id && (!cursorFeature || cursorFeature.passes)) {
    packet.cursor = { feature_id: nextId, done_steps: [], next_step_index: 0 };
    writeJson(F_PACKET, packet);
    console.log(`→ 游标推进到 ${nextId}`);
  }
  const target = (features.features ?? []).map(shapeFeature).find((item) => item.id === packet.cursor.feature_id);
  if (!target) {
    console.error('❌ cursor.feature_id 未指向存在的 feature');
    process.exit(1);
  }
  const steps = target.steps;
  const evidence = [];
  for (let idx = packet.cursor.next_step_index; idx < steps.length; idx += 1) {
    const step = steps[idx];
    const evidencePath = `.handoff/evidence/${packet.session_id}-${target.id}-step-${idx}.txt`;
    const header = evidenceHeader({
      kind: 'step',
      target: `${target.id}#${idx}`,
      sessionId: packet.session_id,
      cmd: step.cmd,
    });
    const result = sh(step.cmd);
    evidence.push({ path: evidencePath, hash: writeEvidence(evidencePath, header, result.code, result.out) });
    if (result.code !== step.expect_exit) {
      packet.cursor.done_steps = Array.from({ length: idx }, (_, item) => item);
      packet.cursor.next_step_index = idx;
      packet.attempt_count = (packet.attempt_count ?? 0) + 1;
      writeJson(F_PACKET, packet);
      console.error(`❌ ${target.id} 第 ${idx} 步失败：exit=${result.code}（期望 ${step.expect_exit}）`);
      console.error(`   证据：${evidencePath}`);
      process.exit(1);
    }
    console.log(`   ✓ ${target.id} 第 ${idx} 步通过`);
  }
  const raw = features.features.find((item) => item.id === target.id);
  raw.passes = true;
  raw.candidate_pass = true;
  writeJson(F_FEATURES, features);
  signed[target.id] = {
    steps: steps.length,
    session_id: packet.session_id,
    signed_at: new Date().toISOString(),
    evidence,
  };
  writeJson(F_SIGNED, signed);
  packet.cursor.done_steps = steps.map((_, idx) => idx);
  packet.cursor.next_step_index = steps.length;
  packet.verdict_pointer = {
    ...(packet.verdict_pointer ?? {}),
    test_output: evidence[evidence.length - 1].path,
  };
  writeJson(F_PACKET, packet);
  console.log(`✅ ${target.id} 全部步骤真实通过，passes 已由脚本翻为 true`);
};

const cmdGate = () => {
  const features = readJson(F_FEATURES);
  const packet = readJson(F_PACKET);
  if (!features || !packet) {
    console.error('❌ 缺少 feature_list.json 或 handoff_packet.json');
    process.exit(1);
  }
  const invariants = (features.invariants ?? []).map(normalizeStep);
  if (!invariants.length) console.warn('⚠ 未声明 invariants，本次门禁为空跑');
  const evidencePath = `.handoff/evidence/${packet.session_id}-gate.txt`;
  let body = '';
  let blocked = 0;
  invariants.forEach((item, idx) => {
    const result = sh(item.cmd);
    const passed = result.code === item.expect_exit;
    if (!passed) blocked += 1;
    body += `\n[inv-${idx}] ${passed ? 'PASS' : 'FAIL'} exit=${result.code} :: ${item.cmd}\n${result.out}\n`;
  });
  const header = evidenceHeader({
    kind: 'gate',
    target: 'invariants',
    sessionId: packet.session_id,
    cmd: `${invariants.length} 条全局不变量`,
  });
  writeEvidence(evidencePath, header, blocked === 0 ? 0 : 1, body);
  packet.verdict_pointer = { ...(packet.verdict_pointer ?? {}), gate_output: evidencePath };
  writeJson(F_PACKET, packet);
  if (blocked > 0) {
    console.error(`❌ 回归门禁未通过：${blocked}/${invariants.length} 条不变量失败，证据 ${evidencePath}`);
    process.exit(1);
  }
  console.log(`✅ 回归门禁全绿，证据 ${evidencePath}`);
};

const cmdCheck = () => {
  const ctx = validate('exit');
  if (ctx.errors.length) {
    printBlocked(ctx);
    process.exit(1);
  }
  ctx.warnings.forEach((item) => console.warn(`   ⚠ ${item}`));
  console.log(`✅ 交接校验通过，放行报告：${rel(writeReport(ctx))}`);
};

const printPrompt = (text) => {
  fs.writeFileSync(F_PROMPT, `${text}\n`, 'utf-8');
  console.log('\n===== 下一窗口提示词（复制下方整段到新会话）=====\n');
  console.log(text);
  console.log(`\n（同样内容已存到 ${rel(F_PROMPT)}）`);
};

/** 失败后重开窗口用：输出当前段的继续提示词，不推进段号 */
const cmdNext = () => {
  const features = readJson(F_FEATURES);
  const packet = readJson(F_PACKET);
  if (!features || !packet) {
    console.error('❌ 缺少 .handoff/feature_list.json 或 handoff_packet.json');
    process.exit(1);
  }
  syncNextAction(features, packet);
  writeJson(F_PACKET, packet);
  const prompt = buildPrompt(features, packet);
  if (!prompt) {
    console.log('🎉 所有 feature 均已通过，任务完成，没有下一段了');
    return;
  }
  printPrompt(prompt);
};

/** 窗口收尾一条命令：run → 回填指针 → gate → 生成 clean_state → check → 打印下一窗口提示词 */
const cmdFinish = () => {
  let features = readJson(F_FEATURES);
  let packet = readJson(F_PACKET);
  if (!features || !packet) {
    console.error('❌ 缺少 .handoff/feature_list.json 或 handoff_packet.json');
    process.exit(1);
  }
  syncNextAction(features, packet);
  writeJson(F_PACKET, packet);
  const target = (features.features ?? []).map(shapeFeature).find((item) => item.id === packet.next_action.feature_id);
  if (target && !target.passes) cmdRun();

  features = readJson(F_FEATURES);
  packet = readJson(F_PACKET);
  syncNextAction(features, packet);
  writeJson(F_PACKET, packet);

  cmdGate();
  // clean_state 必须在 packet 之前落盘（出厂顺序约束），故先写 clean 再回写 packet
  packet = readJson(F_PACKET);
  writeCleanState();
  writeJson(F_PACKET, packet);
  cmdCheck();

  features = readJson(F_FEATURES);
  packet = readJson(F_PACKET);
  const remaining = (features.features ?? []).filter((item) => !item.passes);
  if (remaining.length === 0) {
    console.log('\n🎉 所有 feature 均已通过，任务完成，不需要下一个窗口');
    return;
  }
  const nextSegment = (packet.segment_index ?? 1) + 1;
  packet.parent_session_id = packet.session_id;
  packet.segment_index = nextSegment;
  packet.session_id = `session-${String(nextSegment).padStart(3, '0')}`;
  packet.attempt_count = 0;
  writeJson(F_PACKET, packet);
  writeBaseline(packet.session_id);
  printPrompt(buildPrompt(features, packet));
};

const commands = {
  init: cmdInit,
  seal: cmdSeal,
  next: cmdNext,
  run: cmdRun,
  gate: cmdGate,
  check: cmdCheck,
  finish: cmdFinish,
};
const action = process.argv[2] ?? 'check';
const handler = commands[action];
if (!handler) {
  console.error(`未知子命令：${action}，可选 init / seal / next / run / gate / check / finish`);
  process.exit(1);
}
handler();
