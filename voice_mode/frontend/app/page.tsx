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
import { useCallback, useEffect, useState } from "react";
import type { ConnectionDetails } from "./api/connection-details/route";
import { useKeepAwake } from "@/hooks/useKeepAwake";

export default function Page() {
  const [room] = useState(new Room());
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);

  // Keep the audio session alive while connected so the call survives the phone
  // screen turning off (Android Chrome otherwise freezes the backgrounded tab).
  useKeepAwake(connected);

  const connect = useCallback(async () => {
    // Generate room connection details (room name, participant name, access token,
    // and the LiveKit server URL) then join and open the mic. This is the work the
    // old "Start a conversation" button did — it now lives behind VOICE INPUT.
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
    await room.localParticipant.setMicrophoneEnabled(true);
  }, [room]);

  // VOICE INPUT: connect (+ open mic) on first press; once connected it toggles the
  // microphone so you can mute/unmute without dropping the room.
  const onVoiceInput = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      await connect();
      return;
    }
    await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
  }, [room, connect]);

  // CLEAR: hard reset. Reloading is the simplest way to drop the room, wipe the
  // transcript and release the mic in one shot.
  const onClear = useCallback(() => {
    window.location.reload();
  }, []);

  useEffect(() => {
    const onConnState = (state: ConnectionState) => {
      setConnected(state === ConnectionState.Connected);
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

    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
      room.off(RoomEvent.ConnectionStateChanged, onConnState);
      room.off(RoomEvent.LocalTrackPublished, onMicState);
      room.off(RoomEvent.LocalTrackUnpublished, onMicState);
      room.off(RoomEvent.TrackMuted, onMicState);
      room.off(RoomEvent.TrackUnmuted, onMicState);
    };
  }, [room]);

  return (
    <main data-lk-theme="default" className="h-full grid content-center bg-[var(--lk-bg)]">
      <RoomContext.Provider value={room}>
        <div className="hal-console max-w-[640px] w-[94vw] mx-auto max-h-[96vh] flex flex-col gap-4">
          <HalTitleBar connected={connected} />
          <AgentVisualizer />
          <ButtonBar
            connected={connected}
            micEnabled={micEnabled}
            error={error}
            onVoiceInput={onVoiceInput}
            onClear={onClear}
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
        <span className="hal-title-word hal-title-word--bright">9001</span>
        <span
          className={`hal-led ${props.connected ? "hal-led--on" : ""}`}
          title={props.connected ? "online" : "offline"}
        />
      </div>
    </div>
  );
}

function AgentVisualizer() {
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
      <ReactiveVisualizer trackRef={audioTrack} state={agentState} />
    </div>
  );
}

function ButtonBar(props: {
  connected: boolean;
  micEnabled: boolean;
  error: string;
  onVoiceInput: () => void;
  onClear: () => void;
}) {
  const live = props.connected && props.micEnabled;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full gap-3 justify-center">
        <button
          className={`hal-btn flex-1 ${live ? "hal-btn--active" : ""}`}
          onClick={props.onVoiceInput}
        >
          {live ? "Listening" : "Voice Input"}
        </button>
        <button className="hal-btn flex-1" onClick={props.onClear}>
          Clear
        </button>
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
