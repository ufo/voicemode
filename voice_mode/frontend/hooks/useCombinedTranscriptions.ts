import { useLocalParticipant, useTranscriptions } from "@livekit/components-react";
import { useMemo, useRef } from "react";

// The agent joins the LiveKit room with this identity (see livekit_converse in converse.py).
const AGENT_IDENTITY = "voice-mode-bot";

// livekit-agents tags each transcription stream with the sid of the track it transcribes.
const TRANSCRIBED_TRACK_ID = "lk.transcribed_track_id";

export type CombinedTranscription = {
  id: string;
  text: string;
  role: "user" | "assistant";
  firstReceivedTime: number;
};

export default function useCombinedTranscriptions(): CombinedTranscription[] {
  // livekit-agents 1.x publishes transcription over text streams (topic "lk.transcription"),
  // NOT the legacy per-track TranscriptionReceived events that useTrackTranscription listens
  // for. useTranscriptions reads those text streams, so it captures both the agent's spoken
  // text and the user's STT result.
  const transcriptions = useTranscriptions();
  const { localParticipant } = useLocalParticipant();

  // Every track sid the local participant has EVER published. We must NOT key off a live
  // snapshot of localParticipant.trackPublications: on the phone the mic track churns
  // (screen off/on via keep-awake, backgrounding, network changes republish it with a new
  // sid), so a transcript tagged with an earlier mic sid no longer matches the current
  // publications. Because the user's STT arrives under the agent identity (room_admin
  // attribution) WITH that stale track id, the snapshot test then mis-files the user's own
  // turn as the assistant and left-aligns it. Accumulating sids makes the match churn-proof:
  // a sid that was local once stays local. The agent's TTS track is published by the remote
  // participant, so it never lands in this set — agent speech is still classified correctly.
  const seenLocalSids = useRef<Set<string>>(new Set());
  Array.from(localParticipant.trackPublications.keys()).forEach((sid) =>
    seenLocalSids.current.add(sid)
  );

  const combinedTranscriptions = useMemo(() => {
    const localTrackSids = seenLocalSids.current;

    return transcriptions
      .map((t) => {
        const trackSid = t.streamInfo.attributes?.[TRANSCRIBED_TRACK_ID];
        const identity = t.participantInfo.identity;
        const localMatch = !!trackSid && localTrackSids.has(trackSid);

        // Classify the agent's OWN speech as narrowly as possible, treating everything
        // else as the user. The agent's TTS transcripts arrive tagged as "voice-mode-bot"
        // WITH a transcribed_track_id for its (remote) audio track. The user's turns are
        // either tagged with our local mic track (VAD), or — for a composed KEY XMIT turn —
        // arrive with NO track id and the identity spoof collapsed back to "voice-mode-bot"
        // (so the old `identity !== AGENT` test wrongly filed them under the assistant and
        // left-aligned them). Requiring BOTH the agent identity AND a non-local track id to
        // call something the assistant keeps composed turns on the user's side.
        const isAgentOwn = identity === AGENT_IDENTITY && !!trackSid && !localMatch;
        const isUser = !isAgentOwn;

        return {
          id: t.streamInfo.id,
          text: t.text,
          role: (isUser ? "user" : "assistant") as "user" | "assistant",
          firstReceivedTime: t.streamInfo.timestamp,
        };
      })
      .sort((a, b) => a.firstReceivedTime - b.firstReceivedTime);
  }, [transcriptions, localParticipant]);

  return combinedTranscriptions;
}
