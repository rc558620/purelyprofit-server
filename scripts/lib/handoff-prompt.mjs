import fs from 'fs';
import { F_MODE_DOC, shapeFeature } from './handoff-core.mjs';

/**
 * 下一窗口启动提示词生成器
 *
 * 提示词里的段号、目标 feature、剩余验收命令、改动白名单全部从契约派生，
 * 不经过任何模型的自由发挥；模型只负责把它原样贴给用户。
 */
export const buildPrompt = (featuresRaw, packet) => {
  const targetId = packet.next_action?.feature_id;
  if (!targetId || targetId === 'none') return null;
  const target = (featuresRaw.features ?? []).map(shapeFeature).find((item) => item.id === targetId);
  if (!target) return null;
  const startIndex = packet.cursor?.feature_id === targetId ? packet.cursor.next_step_index ?? 0 : 0;
  const segment = Number.isInteger(packet.segment_index) ? packet.segment_index : 1;
  const doc = fs.existsSync(F_MODE_DOC) ? F_MODE_DOC : '（未找到 docs/docs/handoff-gate-mode.md，请手动补充路径）';
  const stepLines = target.steps
    .slice(startIndex)
    .map((step, offset) => `  [${startIndex + offset}] ${step.cmd}`)
    .join('\n');

  return [
    doc,
    '',
    `按上面这份交接门禁模式（v2）规范执行。你是「${featuresRaw.task_id}」的第 ${segment} 段执行者，只负责一个阶段。`,
    '',
    '【本段目标】',
    `feature: ${target.id} — ${target.description}`,
    `改动白名单：${target.allowed_paths.join(', ') || '未声明'}`,
    '剩余验收步骤：',
    stepLines || '  （无剩余步骤）',
    '',
    '【启动输入】',
    '1. 读取 .handoff/feature_list.json：只关注 passes=false 的条目；不得修改已有条目的 description / acceptance_steps / allowed_paths，不得删除 feature。',
    '2. 读取 .handoff/handoff_packet.json：本段从 cursor 与 next_action 开始工作。',
    '3. 不要引用、推测或询问上一窗口的聊天记录；上一窗口的全部有效信息已在本交接包中。',
    '',
    '【本段规则】',
    '- 只推进上述 feature；需要改白名单外的文件时停下来报告，不要自行扩大范围。',
    '- 不得手工修改 feature_list.json 的 passes。',
    '- 不得手工创建或编辑 .handoff/evidence/ 下的文件，也不得手工编辑 .handoff/verify_state.json。',
    '- 不需要手工写 next_action 与 clean_state.json，脚本会自动生成。',
    '',
    '【收尾】实现完成后只执行一条命令：',
    '  node scripts/handoff-verify.mjs finish',
    '它会依次执行 run / gate / check；全部通过后会直接打印下一窗口的提示词。',
    '你必须把那段提示词原样贴给用户，不要改写、不要省略、不要自己另编一段。',
    'check 未通过就修到通过，不得绕过。',
  ].join('\n');
};
