import {
  loadOrchestratorConfig as loadOrchestratorConfigImpl,
  resolveOrchestratorConfig as resolveOrchestratorConfigImpl,
  inferPackageManager,
  VALID_REVIEW_POLICY_STAGE_VALUES,
  VALID_SUBAGENT_REVIEW_RUNNER_KINDS,
  type OrchestratorConfig,
  type PrReviewAgent,
  type ResolvedOrchestratorConfig,
  type ResolvedReviewPolicy,
  type ReviewPolicy,
  type ReviewPolicyStageValue,
  type SubagentReviewRunnerConfig,
  type SubagentReviewRunnerKind,
} from './config';

export type {
  OrchestratorConfig,
  PrReviewAgent,
  ResolvedOrchestratorConfig,
  ResolvedReviewPolicy,
  ReviewPolicy,
  ReviewPolicyStageValue,
  SubagentReviewRunnerConfig,
  SubagentReviewRunnerKind,
};

export {
  inferPackageManager,
  VALID_REVIEW_POLICY_STAGE_VALUES,
  VALID_SUBAGENT_REVIEW_RUNNER_KINDS,
};

export async function loadOrchestratorConfig(
  cwd: string,
): Promise<OrchestratorConfig> {
  return loadOrchestratorConfigImpl(cwd);
}

export function resolveOrchestratorConfig(
  raw: OrchestratorConfig,
  cwd: string,
): ResolvedOrchestratorConfig {
  return resolveOrchestratorConfigImpl(raw, cwd);
}

export function generateRunDeliverInvocation(
  packageManager: ResolvedOrchestratorConfig['packageManager'],
): string {
  if (packageManager === 'npm') {
    return 'npm run deliver --';
  }

  return `${packageManager} run deliver`;
}
