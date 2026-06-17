import { useEffect } from "react";

// Builds a short, inaudible (all-zero samples) WAV. Looped through an
// HTMLAudioElement it keeps the tab in a "playing media" state, so Android Chrome
// treats it as an active audio session and does NOT freeze/discard it when the
// screen turns off. Combined with the Media Session API below, this lets the
// LiveKit voice session keep running with the phone screen dark.
function buildSilentWav(): string {
  const sampleRate = 8000;
  const seconds = 0.2;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataBytes = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  // samples stay zero -> silence
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

/**
 * Keeps the page's audio session alive while `enabled` is true, so a LiveKit voice
 * call survives the Android screen turning off. No-op when disabled.
 */
export function useKeepAwake(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const audio = new Audio(buildSilentWav());
    audio.loop = true;
    audio.setAttribute("playsinline", "");
    // Zero-amplitude samples mean it is silent regardless, so full volume is fine
    // and guarantees the browser counts it as active media playback.
    audio.volume = 1.0;

    const play = () => {
      audio.play().catch(() => {
        /* autoplay can be blocked until a user gesture; we start after Connect */
      });
    };
    play();

    // Re-assert playback when coming back to the foreground (some browsers pause
    // background media after a while).
    const onVisibility = () => {
      if (document.visibilityState === "visible") play();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Screen Wake Lock: keeps the screen technically on (it can dim/go black) so
    // Android never locks the device and suspends the microphone. The lock is
    // auto-released whenever the page is hidden, so we re-acquire on visibility.
    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } catch {
        /* denied (e.g. low battery) or unsupported; silent loop still helps */
      }
    };
    requestWakeLock();
    const onVisibilityWakeLock = () => {
      if (document.visibilityState === "visible" && wakeLock === null) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityWakeLock);

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Voice Assistant",
          artist: "VoiceMode",
        });
        navigator.mediaSession.playbackState = "playing";
        // Swallow transport controls so the OS notification can't pause us.
        navigator.mediaSession.setActionHandler("play", () => play());
        navigator.mediaSession.setActionHandler("pause", () => play());
      } catch {
        /* MediaSession not fully supported; the silent loop alone still helps */
      }
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("visibilitychange", onVisibilityWakeLock);
      if (wakeLock) {
        wakeLock.release().catch(() => {
          /* already released */
        });
        wakeLock = null;
      }
      audio.pause();
      audio.src = "";
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.playbackState = "none";
          navigator.mediaSession.setActionHandler("play", null);
          navigator.mediaSession.setActionHandler("pause", null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [enabled]);
}
