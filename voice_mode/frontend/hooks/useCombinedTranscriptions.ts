import { useLocalParticipant, useTranscriptions } from "@livekit/components-react";
import { useMemo } from "react";

// The agent joins the LiveKit room with this identity (see livekit_converse in converse.py).
const AGENT_IDENTITY = "voice-mode-bot";

// livekit-agents tags each transcription stream with the sid of the track it transcribes.
const TRANSCRIBED_TRACK_ID = "lk.transcribed_track_id";

export default function useCombinedTranscriptions() {
  // livekit-agents 1.x publishes transcription over text streams (topic "lk.transcription"),
  // NOT the legacy per-track TranscriptionReceived events that useTrackTranscription listens
  // for. useTranscriptions reads those text streams, so it captures both the agent's spoken
  // text and the user's STT result.
  const transcriptions = useTranscriptions();
  const { localParticipant } = useLocalParticipant();

  const combinedTranscriptions = useMemo(() => {
    // Track sids published by the local (browser/phone) participant — i.e. our mic.
    // The agent forwards the user's STT under sender_identity=<user>, but the server only
    // honours that spoof if the bot's token grants it; otherwise BOTH streams arrive tagged
    // as "voice-mode-bot" and identity alone can't tell speaker apart. The transcribed track,
    // however, is unambiguous: the user's mic track is local, the agent's audio track is remote.
    const localTrackSids = new Set(localParticipant.trackPublications.keys());

    return transcriptions
      .map((t) => {
        const trackSid = t.streamInfo.attributes?.[TRANSCRIBED_TRACK_ID];
        // Prefer track ownership; fall back to identity when no track sid is attached.
        const isUser = trackSid
          ? localTrackSids.has(trackSid)
          : t.participantInfo.identity !== AGENT_IDENTITY;
        return {
          id: t.streamInfo.id,
          text: t.text,
          role: isUser ? "user" : "assistant",
          firstReceivedTime: t.streamInfo.timestamp,
        };
      })
      .sort((a, b) => a.firstReceivedTime - b.firstReceivedTime);
  }, [transcriptions, localParticipant]);

  return combinedTranscriptions;
}
