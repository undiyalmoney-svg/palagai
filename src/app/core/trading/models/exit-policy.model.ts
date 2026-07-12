/** How the Trade Engine manages exits for a strategy. */
export type ExitPolicy = 'default' | 'stop_loss_session_close';

export interface ExitPolicyConfig {
  policy: ExitPolicy;
  forceCloseAtEnd: boolean;
}

export const DEFAULT_EXIT_POLICY: ExitPolicyConfig = {
  policy: 'default',
  forceCloseAtEnd: false,
};

export const SESSION_CLOSE_EXIT_POLICY: ExitPolicyConfig = {
  policy: 'stop_loss_session_close',
  forceCloseAtEnd: true,
};

export function exitPolicyConfig(policy: ExitPolicy): ExitPolicyConfig {
  return policy === 'stop_loss_session_close' ? SESSION_CLOSE_EXIT_POLICY : DEFAULT_EXIT_POLICY;
}
