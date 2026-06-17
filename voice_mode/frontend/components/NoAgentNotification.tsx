import type { AgentState } from "@livekit/components-react";

interface NoAgentNotificationProps extends React.PropsWithChildren<object> {
  state: AgentState;
}

/**
 * Disabled no-op.
 *
 * Upstream this renders an "It's quiet... too quiet" banner when no agent registers
 * within 10s. But the VoiceMode v7.4.2 bot joins as a plain participant (identity
 * "voice-mode-bot"), NOT a kind=agent participant, so the AgentState never leaves
 * "connecting" and the banner ALWAYS fires — a false positive that overlaps the eye.
 * We render nothing instead.
 */
export function NoAgentNotification(_props: NoAgentNotificationProps) {
  return null;
}
