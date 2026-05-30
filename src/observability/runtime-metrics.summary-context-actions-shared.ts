import { SUMMARY_ACTION_TARGETS } from './metrics.protocol';
import type {
  SummaryActionId,
  SummaryActionParamsById,
  SummaryActionPayload,
  SummaryActionTargetById,
  SummaryImpactLevel,
  SummaryImpactScope,
  SummaryOwnerType,
  SummaryStatus,
} from './metrics.protocol';
import {
  buildEtaBySeverity,
  buildImpactLevelBySeverity,
} from './runtime-metrics.summary-helpers';

type BuildDrawerActionMetaBaseOptions<TActionId extends SummaryActionId> = {
  actionId: TActionId;
  actionText: string;
  severity: SummaryStatus;
  owner: string;
  ownerType: SummaryOwnerType;
  responsibleTeam: string;
  impactScope: SummaryImpactScope;
  eta?: string;
  impactLevel?: SummaryImpactLevel;
};

export function buildDrawerActionMetaBase<TActionId extends SummaryActionId>(
  options: BuildDrawerActionMetaBaseOptions<TActionId>,
) {
  const {
    actionId,
    actionText,
    severity,
    owner,
    ownerType,
    responsibleTeam,
    impactScope,
    eta,
    impactLevel,
  } = options;

  return {
    actionId,
    actionType: 'drawer' as const,
    actionText,
    actionTarget: SUMMARY_ACTION_TARGETS[
      actionId
    ] as SummaryActionTargetById[TActionId],
    owner,
    ownerType,
    responsibleTeam,
    eta: eta ?? buildEtaBySeverity(severity),
    impactLevel: impactLevel ?? buildImpactLevelBySeverity(severity),
    impactScope,
  };
}

type BuildDrawerActionMetaOptions<
  TActionId extends SummaryActionId,
  TActionParams extends SummaryActionParamsById[TActionId],
> = BuildDrawerActionMetaBaseOptions<TActionId> & {
  actionParams: TActionParams;
  buildPayload: (actionParams: TActionParams) => SummaryActionPayload;
};

export function buildDrawerActionMeta<
  TActionId extends SummaryActionId,
  TActionParams extends SummaryActionParamsById[TActionId],
>(options: BuildDrawerActionMetaOptions<TActionId, TActionParams>) {
  const { actionParams, buildPayload, ...baseOptions } = options;

  return {
    ...buildDrawerActionMetaBase(baseOptions),
    actionParams,
    actionPayload: buildPayload(actionParams),
  };
}
