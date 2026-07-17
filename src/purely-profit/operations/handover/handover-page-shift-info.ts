import { EmployeeShiftType } from '@prisma/client';
import type { HandoverShiftInfoDto } from './dto/handover-page.dto';
import {
  SHIFT_TIME_FALLBACKS,
  buildShiftDateRange,
  resolveShiftLabel,
  toDisplayName,
  type DisplayOperatorInfo,
  type ShiftRecordRow,
} from './handover.shared';

export const buildShiftInfo = (params: {
  shiftType: HandoverShiftInfoDto['shiftType'];
  shiftName: HandoverShiftInfoDto['shiftName'];
  shiftLabel: HandoverShiftInfoDto['shiftLabel'];
  startTime: string;
  endTime: string;
  operatorName: string;
  shiftDate?: Date;
  operatorAvatar?: string;
}): HandoverShiftInfoDto => {
  const shiftReferenceTime = buildShiftDateRange(
    params.startTime,
    params.endTime,
    params.shiftDate ?? new Date(),
  ).startAt;

  return {
    shiftType: params.shiftType,
    shiftName: params.shiftName,
    shiftLabel: params.shiftLabel,
    startTime: params.startTime,
    endTime: params.endTime,
    operatorName: params.operatorName,
    ...(params.operatorAvatar
      ? {
          operatorAvatar: params.operatorAvatar,
          avatar: params.operatorAvatar,
        }
      : {}),
    shiftReferenceAt: shiftReferenceTime.getTime(),
  };
};

export const buildPageShiftInfo = (params: {
  userName?: string | null;
  shiftRecord: ShiftRecordRow | null;
  shiftType: EmployeeShiftType;
  displayOperatorInfo: DisplayOperatorInfo;
  requestedOperatorName?: string;
}): HandoverShiftInfoDto => {
  const { displayOperatorInfo, shiftRecord, shiftType } = params;
  const fallbackTime = SHIFT_TIME_FALLBACKS[shiftType];
  const operatorName =
    toDisplayName(shiftRecord?.employeeName) ??
    displayOperatorInfo.name ??
    '当前员工';

  const shiftName =
    toDisplayName(shiftRecord?.shiftName) ??
    resolveShiftLabel(shiftType, shiftRecord?.shiftName);

  return buildShiftInfo({
    shiftType,
    shiftName,
    shiftLabel: shiftName,
    startTime: shiftRecord?.startTime ?? fallbackTime.startTime,
    endTime: shiftRecord?.endTime ?? fallbackTime.endTime,
    operatorName,
    shiftDate: shiftRecord?.date,
    operatorAvatar: displayOperatorInfo.avatar,
  });
};
