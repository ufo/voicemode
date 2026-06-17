import { useTranscriptions } from "@livekit/components-react";
import { useMemo } from "react";

// The agent joins the LiveKit room with this identity (see livekit_converse in converse.py).
const AGENT_IDENTITY = "voice-mode-bot";

export default function useCombinedTranscriptions() {
  // livekit-agents 1.x publishes transcription over text streams (topic "lk.transcription"),
  // NOT the legacy per-track TranscriptionReceived events that useTrackTranscription listens
  // for. useTranscriptions reads those text streams, so it captures both the agent's spoken
  // text and the user's STT result.
  const transcriptions = useTranscriptions();

  const combinedTranscriptions = useMemo(() => {
    return transcriptions
      .map((t) => ({
        id: t.streamInfo.id,
        text: t.text,
        role: t.participantInfo.identity === AGENT_IDENTITY ? "assistant" : "user",
        firstReceivedTime: t.streamInfo.timestamp,
      }))
      .sort((a, b) => a.firstReceivedTime - b.firstReceivedTime);
  }, [transcriptions]);

  return combinedTranscriptions;
}
