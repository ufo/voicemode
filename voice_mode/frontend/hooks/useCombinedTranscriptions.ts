import { useRoomContext, useTranscriptions } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { useEffect, useMemo, useState } from "react";

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
  const room = useRoomContext();

  // All track SIDs the local participant has EVER published, stored as React state so
  // the useMemo below re-runs and reclassifies existing transcriptions whenever a new
  // track appears (e.g. mic churn on Android after screen-off/on). A mutable ref would
  // not trigger a memo re-run — state does. The agent's TTS track is remote, so it
  // never lands in this set; only the local mic SID(s) accumulate here.
  const [seenLocalSids, setSeenLocalSids] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const accumulate = () => {
      const currentSids = Array.from(room.localParticipant.trackPublications.keys());
      setSeenLocalSids((prev) => {
        const hasNew = currentSids.some((sid) => !prev.has(sid));
        if (!hasNew) return prev; // return same ref to skip re-render
        const next = new Set(prev);
        currentSids.forEach((sid) => next.add(sid));
        return next;
      });
    };
    accumulate(); // capture any tracks already published at hook-mount time
    room.on(RoomEvent.LocalTrackPublished, accumulate);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, accumulate);
    };
  }, [room]);

  const combinedTranscriptions = useMemo(() => {
    return transcriptions
      .map((t) => {
        const trackSid = t.streamInfo.attributes?.[TRANSCRIBED_TRACK_ID];
        const identity = t.participantInfo.identity;
        const localMatch = !!trackSid && seenLocalSids.has(trackSid);

        // Classify the agent's OWN speech as narrowly as possible, treating everything
        // else as the user. The agent's TTS transcripts arrive tagged as "voice-mode-bot"
        // WITH a transcribed_track_id for its (remote) audio track. The user's turns are
        // either tagged with our local mic track (VAD, localMatch=true), or arrive with
        // NO track id (KEY XMIT composed turns, !!trackSid=false). Both cases fall
        // through to "user" — only the agent's own remote-track transcription is "assistant".
        const isAgentOwn = identity === AGENT_IDENTITY && !!trackSid && !localMatch;

        return {
          id: t.streamInfo.id,
          text: t.text,
          role: (isAgentOwn ? "assistant" : "user") as "user" | "assistant",
          firstReceivedTime: t.streamInfo.timestamp,
        };
      })
      .sort((a, b) => a.firstReceivedTime - b.firstReceivedTime);
  }, [transcriptions, seenLocalSids]);

  return combinedTranscriptions;
}
