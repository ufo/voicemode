"use client";

import { useMultibandTrackVolume, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useEffect, useRef } from "react";

// Reuse the hook's own track type so we stay in sync with the installed version.
type TrackArg = Parameters<typeof useMultibandTrackVolume>[0];

interface ReactiveVisualizerProps {
  // Kept for API compatibility; the track is now sourced from useTracks below.
  trackRef?: TrackArg;
  state?: string;
}

// IMPORTANT: useMultibandTrackVolume slices the FFT bins with `opts.loPass`/`opts.hiPass`
// (the raw options, not the merged defaults), so BOTH must be passed. The low bins hold
// nearly all voice energy, so we keep the low end (loPass:1, dropping only the DC bin) and
// cap the high end well below the silent ultrasonic bins. A high loPass would throw away the
// voice and leave the eye dead.
const VOLUME_OPTS = { bands: 64, loPass: 1, hiPass: 256 } as const;

const BANDS = 64;

export default function ReactiveVisualizer({ state = "disconnected" }: ReactiveVisualizerProps) {
  // Both the local microphone AND the agent's TTS are published as microphone-source
  // tracks, so useTracks surfaces them together and updates on (un)subscribe. We do NOT
  // rely on useVoiceAssistant().audioTrack, which only works if the agent participant is
  // classified as kind=agent (this agent isn't), leaving its track undetected.
  const trackRefs = useTracks([Track.Source.Microphone]);
  const localRef = trackRefs.find((t) => t.participant.isLocal) as TrackArg;
  const remoteRef = trackRefs.find((t) => !t.participant.isLocal) as TrackArg;

  const localBands = useMultibandTrackVolume(localRef, VOLUME_OPTS);
  const remoteBands = useMultibandTrackVolume(remoteRef, VOLUME_OPTS);
  // The eye reacts whether the user or the assistant is speaking.
  const bands = localBands.map((v, i) => Math.max(v, remoteBands[i] ?? 0));

  // The hooks re-render on every audio frame; mirror outputs into refs so the
  // requestAnimationFrame loop reads the latest values without re-subscribing.
  const bandsRef = useRef<number[]>(bands);
  bandsRef.current = bands;
  const stateRef = useRef(state);
  stateRef.current = state;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const smooth = new Array(BANDS).fill(0);
    let level = 0; // smoothed overall loudness
    let bassS = 0; // smoothed bass
    let t = 0;
    let raf = 0;

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 0.016;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);

      const raw = bandsRef.current;
      const n = BANDS;
      let energy = 0;
      for (let i = 0; i < n; i++) {
        const v = raw && raw.length ? raw[i % raw.length] || 0 : 0;
        // Attack fast, release slow -> punchy but smooth.
        smooth[i] = v > smooth[i] ? lerp(smooth[i], v, 0.6) : lerp(smooth[i], v, 0.12);
        energy += smooth[i];
      }
      energy /= n;
      let bass = 0;
      for (let i = 0; i < 6; i++) bass += smooth[i];
      bass /= 6;

      level = lerp(level, clamp(energy * 3.0, 0, 1), energy * 3.0 > level ? 0.5 : 0.1);
      bassS = lerp(bassS, clamp(bass * 2.8, 0, 1), bass * 2.8 > bassS ? 0.6 : 0.12);

      // HAL is never fully dark; a faint breathing baseline keeps the eye "awake".
      const st = stateRef.current;
      const breathe = (Math.sin(t * 1.1) * 0.5 + 0.5) * (st === "thinking" ? 0.18 : 0.08);
      const act = clamp(level + breathe * 0.4, 0, 1); // overall activity

      const R = minDim * 0.38; // lens outer radius

      // --- Solid black backdrop (a lens reads wrong with motion trails) ---
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      // --- Chrome bezel: brushed-metal ring around a dark lens housing ---
      // Dark housing rim sits just inside the chrome so there's no gap to the lens.
      const housingR = R * 1.2;
      const housing = ctx.createRadialGradient(cx, cy - R * 0.15, R * 0.2, cx, cy, housingR);
      housing.addColorStop(0, "#1c1c20");
      housing.addColorStop(0.6, "#101013");
      housing.addColorStop(1, "#040405");
      ctx.fillStyle = housing;
      ctx.beginPath();
      ctx.arc(cx, cy, housingR, 0, Math.PI * 2);
      ctx.fill();

      // Chrome ring: a conic gradient fakes metallic reflections (bright near the
      // top & bottom, dark at the sides), drawn as an annulus over the housing.
      const chromeOuter = R * 1.2;
      const chromeInner = R * 1.08;
      const chrome = ctx.createConicGradient(-Math.PI / 2, cx, cy);
      const chromeStops: [number, string][] = [
        [0.0, "#f6f8fa"],
        [0.08, "#aeb4ba"],
        [0.2, "#43474c"],
        [0.32, "#cfd3d7"],
        [0.5, "#5f656b"],
        [0.62, "#2b2d30"],
        [0.74, "#dce0e3"],
        [0.85, "#80868c"],
        [0.94, "#3a3d41"],
        [1.0, "#f6f8fa"],
      ];
      for (const [p, c] of chromeStops) chrome.addColorStop(p, c);
      ctx.fillStyle = chrome;
      ctx.beginPath();
      ctx.arc(cx, cy, chromeOuter, 0, Math.PI * 2);
      ctx.arc(cx, cy, chromeInner, 0, Math.PI * 2, true);
      ctx.fill("evenodd");

      // Bright rim on the outer edge, dark groove on the inner edge -> rounded metal.
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(cx, cy, chromeOuter - 0.75 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(cx, cy, chromeInner + 0.75 * dpr, 0, Math.PI * 2);
      ctx.stroke();

      const hot = clamp(level, 0, 1); // how white-hot the center burns

      // Everything red is clipped to the lens opening so the glow/bloom can never
      // spill past the outer circle into the black housing.
      const lensR = R; // the visible outer circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
      ctx.clip();

      // --- The red lens glow (fades out before the clip edge) ---
      const glowR = lensR * (0.82 + act * 0.16);
      const lens = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      lens.addColorStop(0, `hsla(${20 + hot * 30}, 100%, ${72 + hot * 22}%, 1)`);
      lens.addColorStop(0.16, `hsla(${6 + hot * 18}, 100%, ${55 + hot * 18}%, 0.98)`);
      lens.addColorStop(0.5, `hsla(0, 100%, ${30 + hot * 12}%, 0.92)`);
      lens.addColorStop(0.82, "hsla(0, 100%, 16%, 0.55)");
      lens.addColorStop(1, "hsla(0, 100%, 8%, 0)");
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
      ctx.fill();

      // --- Additive bloom, also confined within the lens ---
      ctx.globalCompositeOperation = "lighter";
      const bloomR = lensR * (0.75 + act * 0.22);
      const bloom = ctx.createRadialGradient(cx, cy, glowR * 0.3, cx, cy, bloomR);
      bloom.addColorStop(0, `hsla(2, 100%, 50%, ${0.18 + act * 0.4})`);
      bloom.addColorStop(1, "hsla(2, 100%, 50%, 0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, bloomR, 0, Math.PI * 2);
      ctx.fill();

      // --- The pupil: a bright hot core that pulses with the low end ---
      const pupilR = lensR * (0.11 + bassS * 0.16 + breathe * 0.03);
      const pupil = ctx.createRadialGradient(cx, cy, 0, cx, cy, pupilR);
      pupil.addColorStop(0, "rgba(255,255,245,0.98)");
      pupil.addColorStop(0.4, `hsla(${42 + hot * 10}, 100%, 70%, 0.92)`);
      pupil.addColorStop(1, "hsla(30, 100%, 55%, 0)");
      ctx.fillStyle = pupil;
      ctx.beginPath();
      ctx.arc(cx, cy, pupilR, 0, Math.PI * 2);
      ctx.fill();

      // --- Glassy specular highlight (fixed reflection up-left) ---
      const specR = lensR * 0.5;
      const sx = cx - lensR * 0.32;
      const sy = cy - lensR * 0.34;
      const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, specR);
      spec.addColorStop(0, "rgba(255,255,255,0.16)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(sx, sy, specR, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full rounded-2xl"
      style={{ background: "#000000" }}
    />
  );
}
