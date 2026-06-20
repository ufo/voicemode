"use client";

import { NoAgentNotification } from "@/components/NoAgentNotification";
import ReactiveVisualizer from "@/components/ReactiveVisualizer";
import TranscriptionView from "@/components/TranscriptionView";
import {
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ConnectionState, Room, RoomEvent } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionDetails } from "./api/connection-details/route";
import { useKeepAwake } from "@/hooks/useKeepAwake";

export default function Page() {
  // stopMicTrackOnMute:false (the default, set explicitly here) — muting the mic keeps the
  // track PUBLISHED (just disabled) rather than stopping it, so the agent stays subscribed
  // across mute/unmute. We rely on this to pre-publish a muted mic at connect (see connect())
  // so KEY XMIT captures its very first turn.
  const [room] = useState(() => new Room({ publishDefaults: { stopMicTrackOnMute: false } }));
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  // Compose (push-to-talk) mode: when true, the next turn is driven manually — the
  // agent holds its VAD and we commit explicitly. botPresent gates the button: the
  // agent only exists in the room while it's listening for this turn's reply.
  const [composing, setComposing] = useState(false);
  const [botPresent, setBotPresent] = useState(false);
  // COM button lifecycle: false+!connected = LINK (join), connected = HALT (leave the
  // room), halted = CYCLE (reload). Set when the user halts a live conversation.
  const [halted, setHalted] = useState(false);
  // Whether the mic was already open (AUTO XMIT) when a compose turn began, so commit can
  // restore that state rather than leaving the mic on and lighting AUTO XMIT up.
  const micOpenBeforeCompose = useRef(false);

  // Keep the audio session alive while connected so the call survives the phone
  // screen turning off (Android Chrome otherwise freezes the backgrounded tab).
  useKeepAwake(connected);

  const connect = useCallback(async () => {
    // Generate room connection details (room name, participant name, access token, and
    // the LiveKit server URL) then join the room and pre-publish the mic MUTED. Publishing
    // up front means the agent (which binds its STT input at session.start) subscribes to a
    // live track immediately; the transmit buttons just unmute it. Muting it keeps AUTO XMIT
    // resting (isMicrophoneEnabled=false) and no audio leaves the device until you press a
    // button. Without this the first KEY XMIT press publishes a track the agent hasn't
    // subscribed to yet, so the composed turn is lost (the "press AUTO XMIT first" bug).
    setError("");

    const url = new URL(
      process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? "/api/connection-details",
      window.location.origin
    );

    const response = await fetch(url.toString());
    if (!response.ok) {
      setError("Connection failed");
      return;
    }

    const connectionDetailsData: ConnectionDetails = await response.json();
    await room.connect(connectionDetailsData.serverUrl, connectionDetailsData.participantToken);
    // Publish the mic track, then immediately mute it: the track stays published (see the
    // Room's stopMicTrackOnMute:false) so the agent can subscribe, but no audio is sent and
    // AUTO XMIT shows resting until a transmit button unmutes it.
    await room.localParticipant.setMicrophoneEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(false);
  }, [room]);

  // COM START / COM RESET: the only button that owns the room lifecycle. When not
  // connected it joins (+ opens mic) and arms audio playback; once connected the same
  // button hard-resets by reloading (drops the room, wipes the transcript, frees the mic).
  const onComm = useCallback(async () => {
    // Three states on one button:
    //   COM HALT  (connected)            → fully stop the conversation, leaving the room.
    //   COM CYCLE (halted, post-call)    → reload the page for a clean slate.
    //   COM LINK  (fresh, not connected) → join the room (+ arm audio playback).
    if (room.state === ConnectionState.Connected) {
      await room.disconnect();
      setHalted(true);
      return;
    }
    if (halted) {
      window.location.reload();
      return;
    }
    await connect();
    // Mobile Chrome only sounds REMOTE tracks after startAudio() runs inside a user
    // gesture. The bot joins per-turn (its track always arrives after connect), so arm
    // playback here within the COM LINK press so the agent's greeting is audible.
    try {
      await room.startAudio();
    } catch {
      // No-op: harmless if there's no audio context yet.
    }
  }, [room, connect, halted]);

  // AUTO XMIT / VOX: VAD free-hand listening. Toggles the mic so you can mute/unmute
  // without dropping the room. Gated on connected (disabled otherwise), so the room is
  // already up when this runs — COM START owns the connect.
  const onVoiceInput = useCallback(async () => {
    try {
      await room.startAudio();
    } catch {
      // No-op: arm playback for whatever remote track shows up; harmless pre-context.
    }
    await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
  }, [room]);

  // KEY XMIT / RCV: push-to-talk turn. First press tells the agent to switch this turn to
  // manual turn detection (no VAD auto-commit) so you can pause mid-sentence; second
  // press commits the whole thing for transcription. Driven over LiveKit RPC to the agent
  // participant ("voice-mode-bot"). Gated on the agent being present (disabled otherwise).
  const onCompose = useCallback(async () => {
    // Clear any stale "Compose unavailable" from a prior press so a recovered turn
    // doesn't keep showing the old error.
    setError("");
    try {
      await room.startAudio();
    } catch {
      // No-op: harmless if there's no audio context yet.
    }
    try {
      if (!composing) {
        // Compose needs the mic publishing to capture the spoken turn. Remember whether
        // it was already open (AUTO XMIT) so commit can restore that exact state.
        micOpenBeforeCompose.current = room.localParticipant.isMicrophoneEnabled;
        if (!room.localParticipant.isMicrophoneEnabled) {
          await room.localParticipant.setMicrophoneEnabled(true);
        }
        await room.localParticipant.performRpc({
          destinationIdentity: "voice-mode-bot",
          method: "ptt_start",
          payload: "",
        });
        setComposing(true);
      } else {
        await room.localParticipant.performRpc({
          destinationIdentity: "voice-mode-bot",
          method: "ptt_commit",
          payload: "",
        });
        setComposing(false);
        // Close the mic again if compose was what opened it, so AUTO XMIT returns to its
        // resting state instead of lighting up as live once the turn ends.
        if (!micOpenBeforeCompose.current) {
          await room.localParticipant.setMicrophoneEnabled(false);
        }
      }
    } catch (e) {
      // Agent gone (e.g. turn already ended) — drop back to idle rather than wedging
      // the button in "RCV" forever, and undo any mic we opened for this turn.
      setComposing(false);
      setError("Compose unavailable — agent not listening");
      if (!micOpenBeforeCompose.current) {
        try {
          await room.localParticipant.setMicrophoneEnabled(false);
        } catch {
          // No-op: best-effort mic cleanup.
        }
      }
    }
  }, [room, composing]);

  useEffect(() => {
    // The agent ("voice-mode-bot") joins only while listening for the current turn and
    // disconnects when it returns the transcript. Track its presence to gate Compose,
    // and drop out of composing if it vanishes mid-turn.
    const BOT_IDENTITY = "voice-mode-bot";
    const syncBotPresent = () => {
      const present = Array.from(room.remoteParticipants.values()).some(
        (p) => p.identity === BOT_IDENTITY
      );
      setBotPresent(present);
      if (!present) setComposing(false);
      // Clear a stale "Compose unavailable" once the agent is back — otherwise the
      // error set on a press-while-absent lingers until the next reconnect.
      if (present) setError("");
    };
    const onConnState = (state: ConnectionState) => {
      const isConnected = state === ConnectionState.Connected;
      setConnected(isConnected);
      // The agent is usually ALREADY in the room when we connect (it joined when the
      // converse turn started). RoomEvent.ParticipantConnected does NOT fire for
      // participants that were already present at join time, so re-sync bot presence
      // here on connect — otherwise KEY XMIT stays greyed out on a fresh load until
      // some unrelated participant event happens to fire (the incognito "can't press
      // the button" bug).
      if (isConnected) syncBotPresent();
    };
    const onMicState = () => {
      setMicEnabled(room.localParticipant.isMicrophoneEnabled);
    };
    room.on(RoomEvent.MediaDevicesError, onDeviceFailure);
    room.on(RoomEvent.ConnectionStateChanged, onConnState);
    room.on(RoomEvent.LocalTrackPublished, onMicState);
    room.on(RoomEvent.LocalTrackUnpublished, onMicState);
    room.on(RoomEvent.TrackMuted, onMicState);
    room.on(RoomEvent.TrackUnmuted, onMicState);
    room.on(RoomEvent.ParticipantConnected, syncBotPresent);
    room.on(RoomEvent.ParticipantDisconnected, syncBotPresent);
    syncBotPresent();

    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
      room.off(RoomEvent.ConnectionStateChanged, onConnState);
      room.off(RoomEvent.LocalTrackPublished, onMicState);
      room.off(RoomEvent.LocalTrackUnpublished, onMicState);
      room.off(RoomEvent.TrackMuted, onMicState);
      room.off(RoomEvent.TrackUnmuted, onMicState);
      room.off(RoomEvent.ParticipantConnected, syncBotPresent);
      room.off(RoomEvent.ParticipantDisconnected, syncBotPresent);
    };
  }, [room]);

  return (
    <main data-lk-theme="default" className="h-full grid content-center bg-[var(--lk-bg)]">
      <RoomContext.Provider value={room}>
        <div className="hal-console max-w-[640px] w-[94vw] mx-auto max-h-[96vh] flex flex-col gap-4">
          <HalTitleBar connected={connected} />
          <AgentVisualizer connected={connected} />
          <ButtonBar
            connected={connected}
            micEnabled={micEnabled}
            composing={composing}
            botPresent={botPresent}
            halted={halted}
            error={error}
            onComm={onComm}
            onVoiceInput={onVoiceInput}
            onCompose={onCompose}
          />
          <TranscriptionView />
          <RoomAudioRenderer />
          <AgentStatus />
        </div>
      </RoomContext.Provider>
    </main>
  );
}

function HalTitleBar(props: { connected: boolean }) {
  return (
    <div className="hal-title flex w-full select-none">
      <div className="hal-title-left flex items-center justify-end flex-1 py-3 pr-5">
        <span className="hal-title-word -mr-[0.28em]">HAL</span>
      </div>
      <div className="hal-title-right flex items-center justify-start flex-1 py-3 pl-5 relative">
        <span className="hal-title-word hal-title-word--bright">101</span>
        <span
          className={`hal-led ${props.connected ? "hal-led--on" : ""}`}
          title={props.connected ? "online" : "offline"}
        />
      </div>
    </div>
  );
}

function AgentVisualizer(props: { connected: boolean }) {
  const { state: agentState, videoTrack, audioTrack } = useVoiceAssistant();

  if (videoTrack) {
    return (
      <div className="h-[300px] w-full rounded-lg overflow-hidden">
        <VideoTrack trackRef={videoTrack} />
      </div>
    );
  }
  return (
    <div className="h-[360px] w-full">
      <ReactiveVisualizer trackRef={audioTrack} state={agentState} connected={props.connected} />
    </div>
  );
}

function ButtonBar(props: {
  connected: boolean;
  micEnabled: boolean;
  composing: boolean;
  botPresent: boolean;
  halted: boolean;
  error: string;
  onComm: () => void;
  onVoiceInput: () => void;
  onCompose: () => void;
}) {
  const live = props.connected && props.micEnabled;
  // VOX (auto-listen) reads as live only when it owns the turn — while composing the
  // mic is open too, but KEY XMIT owns that turn, so VOX falls back to its resting label.
  const voxLive = live && !props.composing;
  // Compose is only meaningful while the agent is in the room listening for a reply.
  // Once you're composing, keep the button active so you can press it again to send.
  const composeEnabled = props.botPresent || props.composing;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full gap-3 justify-center">
        {/* COM LINK → COM HALT → COM CYCLE: the room-lifecycle button (see onComm). */}
        <div className="hal-key flex-1 basis-0">
          <button className="hal-btn w-full whitespace-nowrap" onClick={props.onComm}>
            {props.connected ? "COM HALT" : props.halted ? "COM CYCLE" : "COM LINK"}
          </button>
        </div>
        {/* AUTO XMIT → VOX: VAD free-hand listening; disabled until connected. */}
        <div className="hal-key flex-1 basis-0">
          <button
            className={`hal-btn w-full whitespace-nowrap hal-btn--bright ${voxLive ? "hal-btn--active" : ""}`}
            onClick={props.onVoiceInput}
            disabled={!props.connected}
          >
            {voxLive ? "VOX" : "AUTO XMIT"}
          </button>
        </div>
        {/* KEY XMIT → RCV: push-to-talk compose; disabled until the agent is listening. */}
        <div className="hal-key flex-1 basis-0">
          <button
            className={`hal-btn w-full whitespace-nowrap hal-btn--bright ${props.composing ? "hal-btn--active" : ""}`}
            onClick={props.onCompose}
            disabled={!composeEnabled}
          >
            {props.composing ? "RCV" : "KEY XMIT"}
          </button>
        </div>
      </div>
      {props.error && <p className="text-red-400 text-xs">{props.error}</p>}
    </div>
  );
}

function AgentStatus() {
  const { state: agentState } = useVoiceAssistant();
  return <NoAgentNotification state={agentState} />;
}

function onDeviceFailure(error: Error) {
  console.error(error);
  alert(
    "Error acquiring camera or microphone permissions. Please make sure you grant the necessary permissions in your browser and reload the tab"
  );
}
