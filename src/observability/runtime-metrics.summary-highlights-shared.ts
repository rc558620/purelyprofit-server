import {
  SUMMARY_ACTION_TEXT_MODE,
  SUMMARY_ACTION_VERSION,
} from './metrics.protocol';
import type {
  SummaryActionParams,
  SummaryActionPayload,
  SummaryHighlight,
} from './metrics.protocol';
import type {
  SummaryHighlightActionMeta,
  SummaryProcessActionMeta,
} from './runtime-metrics.summary-context.types';

export type SummaryHighlightActionMetaLike =
  | SummaryProcessActionMeta
  | SummaryHighlightActionMeta;

type BuildSummaryHighlightOptions = Omit<
  SummaryHighlight,
  | 'actionVersion'
  | 'actionTextMode'
  | 'actionId'
  | 'actionType'
  | 'actionText'
  | 'actionTarget'
  | 'actionParams'
  | 'actionPayload'
  | 'owner'
  | 'ownerType'
  | 'responsibleTeam'
  | 'eta'
  | 'impactLevel'
  | 'impactScope'
> & {
  actionMeta: SummaryHighlightActionMetaLike;
  actionParams?: SummaryActionParams;
  actionPayload?: SummaryActionPayload;
};

export function buildSummaryHighlight(
  options: BuildSummaryHighlightOptions,
): SummaryHighlight {
  const { actionMeta, actionParams, actionPayload, ...rest } = options;

  return {
    ...rest,
    actionId: actionMeta.actionId,
    actionVersion: SUMMARY_ACTION_VERSION,
    actionType: actionMeta.actionType,
    actionText: actionMeta.actionText,
    actionTextMode: SUMMARY_ACTION_TEXT_MODE,
    actionTarget: actionMeta.actionTarget,
    actionParams: actionParams ?? actionMeta.actionParams,
    actionPayload: actionPayload ?? actionMeta.actionPayload,
    owner: actionMeta.owner,
    ownerType: actionMeta.ownerType,
    responsibleTeam: actionMeta.responsibleTeam,
    eta: actionMeta.eta,
    impactLevel: actionMeta.impactLevel,
    impactScope: actionMeta.impactScope,
  };
}
