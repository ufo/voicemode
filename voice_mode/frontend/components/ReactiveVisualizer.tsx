"use client";

import {
  useMultibandTrackVolume,
  useRemoteParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useEffect, useRef } from "react";
// Realistic HAL lens photo (dark glass dome + real room reflections + red glow). Lives in
// app/eye.png; webpack rewrites the import to a served URL. Used as the lens base instead
// of drawing reflections by hand.
import eyeSrc from "../app/eye.png";

// The agent joins the room with this identity (see livekit_converse in converse.py).
const AGENT_IDENTITY = "voice-mode-bot";

// Reuse the hook's own track type so we stay in sync with the installed version.
type TrackArg = Parameters<typeof useMultibandTrackVolume>[0];

interface ReactiveVisualizerProps {
  // Kept for API compatibility; the track is now sourced from useTracks below.
  trackRef?: TrackArg;
  state?: string;
  // Whether the phone is in the LiveKit room. The eye burns red the whole time you're in
  // the room (small when HAL is away, full-size once the agent joins); when not connected
  // it falls back to the dormant dark lens.
  connected?: boolean;
}

// IMPORTANT: useMultibandTrackVolume slices the FFT bins with `opts.loPass`/`opts.hiPass`
// (the raw options, not the merged defaults), so BOTH must be passed. The low bins hold
// nearly all voice energy, so we keep the low end (loPass:1, dropping only the DC bin) and
// cap the high end well below the silent ultrasonic bins. A high loPass would throw away the
// voice and leave the eye dead.
const VOLUME_OPTS = { bands: 64, loPass: 1, hiPass: 256 } as const;

const BANDS = 64;

export default function ReactiveVisualizer({
  state = "disconnected",
  connected = false,
}: ReactiveVisualizerProps) {
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

  // The eye only burns red while Claude (the agent) is actually in the room. The bot
  // joins per voice turn and leaves between turns, so the lens goes dormant (dark) in
  // between. Mirror presence into a ref the rAF loop reads without re-subscribing.
  const remoteParticipants = useRemoteParticipants();
  const botPresent = remoteParticipants.some((p) => p.identity === AGENT_IDENTITY);
  const presentRef = useRef(botPresent);
  presentRef.current = botPresent;

  // Mirror room-connection state into a ref the rAF loop reads. The eye glows red the
  // whole time we're connected, not only while the bot is mid-turn.
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

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
    let gf = 0.35; // smoothed red-glow size factor (small light when HAL is away, fills lens when present)

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    // Load the realistic lens photo once; the draw loop blends it in as soon as it's ready.
    const eyeImg = new Image();
    let eyeReady = false;
    eyeImg.onload = () => {
      eyeReady = true;
    };
    eyeImg.src = eyeSrc.src;

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
        // Attack fast, release quick -> the eye snaps up on sound and bounces back down
        // promptly instead of lingering (release was 0.12, too sluggish at the small size).
        smooth[i] = v > smooth[i] ? lerp(smooth[i], v, 0.6) : lerp(smooth[i], v, 0.28);
        energy += smooth[i];
      }
      energy /= n;
      let bass = 0;
      for (let i = 0; i < 6; i++) bass += smooth[i];
      bass /= 6;

      // Gain is high so ordinary voice drives `level`/`bassS` to ~1, which pushes the glow
      // out to the chrome ring on speech. The fast release (0.25/0.28) then snaps it back
      // down between words so it bounces instead of sitting pinned at the ring.
      const lvlTarget = clamp(energy * 6.0, 0, 1);
      const bassTarget = clamp(bass * 5.0, 0, 1);
      level = lerp(level, lvlTarget, lvlTarget > level ? 0.5 : 0.25);
      bassS = lerp(bassS, bassTarget, bassTarget > bassS ? 0.6 : 0.28);

      // HAL is never fully dark; a faint breathing baseline keeps the eye "awake".
      const st = stateRef.current;
      const breathe = (Math.sin(t * 1.1) * 0.5 + 0.5) * (st === "thinking" ? 0.18 : 0.08);
      const act = clamp(level + breathe * 0.4, 0, 1); // overall activity

      const R = minDim * 0.38; // lens outer radius — the lens + chrome bezel stay full size

      // The red glow in the centre is just a small light when HAL isn't in the room and
      // grows to fill the lens once the agent joins. Lerp so it eases between the two.
      const gfTarget = presentRef.current ? 1.0 : 0.35;
      gf = lerp(gf, gfTarget, 0.08);

      // --- Solid black backdrop (a lens reads wrong with motion trails) ---
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      // --- Grille panels flanking the eye (the HAL "audio box" speaker cover) ---
      // A grey woven-mesh grille fills the empty black space either side of the lens. The
      // console frame bezels its outer edge and the dividers bezel its top and bottom; the
      // eye-facing inner edge gets its own vertical chrome bezel here, so the grille reads
      // as fully surrounded. A black gap is left between that bezel and the eye's chrome
      // ring so the two never touch. Square throughout — no rounded corners.
      const drawGrille = (side: number) => {
        const eyeBezelR = R * 1.2; // matches chromeOuter below
        const gap = minDim * 0.05; // black gap from the eye's chrome ring
        const bezelW = Math.max(5 * dpr, minDim * 0.03); // inner chrome bezel width

        const innerX = cx + side * (eyeBezelR + gap); // edge nearest the eye
        const outerX = side < 0 ? 0 : w; // flush to the canvas (console bezel) edge
        const left = Math.min(innerX, outerX);
        const right = Math.max(innerX, outerX);
        const pw = right - left;
        if (pw < bezelW * 2.5) return; // too narrow to read — skip

        // The chrome bezel hugs the inner (eye-facing) edge; the mesh fills the rest.
        const bezelX = side < 0 ? right - bezelW : left;
        const meshLeft = side < 0 ? left : left + bezelW;
        const meshRight = side < 0 ? right - bezelW : right;
        const meshW = meshRight - meshLeft;

        // --- Grey woven mesh: dark base crossed by fine horizontal AND vertical ribs ---
        ctx.save();
        ctx.beginPath();
        ctx.rect(meshLeft, 0, meshW, h);
        ctx.clip();
        ctx.fillStyle = "#202225"; // dark groove base
        ctx.fillRect(meshLeft, 0, meshW, h);
        const step = Math.max(3 * dpr, minDim * 0.016);
        const ribW = Math.max(1 * dpr, step * 0.42);
        ctx.fillStyle = "rgba(104, 109, 114, 0.7)"; // dim rib crest — muted so it doesn't pull focus from the eye
        for (let y = step * 0.4; y < h; y += step) {
          ctx.fillRect(meshLeft, y, meshW, ribW); // horizontal slats
        }
        for (let x = meshLeft + step * 0.4; x < meshRight; x += step) {
          ctx.fillRect(x, 0, ribW, h); // vertical ribs crossing them
        }
        // Convex sheen + top-down lighting so it reads as curved metal, not a flat sticker.
        const sheen = ctx.createLinearGradient(meshLeft, 0, meshRight, 0);
        sheen.addColorStop(0.0, "rgba(0, 0, 0, 0.3)");
        sheen.addColorStop(0.5, "rgba(255, 255, 255, 0.06)");
        sheen.addColorStop(1.0, "rgba(0, 0, 0, 0.3)");
        ctx.fillStyle = sheen;
        ctx.fillRect(meshLeft, 0, meshW, h);
        const lit = ctx.createLinearGradient(0, 0, 0, h);
        lit.addColorStop(0.0, "rgba(255, 255, 255, 0.1)");
        lit.addColorStop(0.4, "rgba(0, 0, 0, 0)");
        lit.addColorStop(1.0, "rgba(0, 0, 0, 0.3)");
        ctx.fillStyle = lit;
        ctx.fillRect(meshLeft, 0, meshW, h);
        ctx.restore();

        // --- Inner chrome bezel: a vertical brushed-metal rib framing the grille on the
        // eye-facing side, the same chrome as the console frame and dividers. ---
        const sweep = ctx.createLinearGradient(0, 0, 0, h);
        // Dimmed gunmetal chrome (the bright palette scaled down ~55%) so the bezel
        // recedes next to the eye's bright ring.
        const chromeStopsV: [number, string][] = [
          [0.0, "#878889"],
          [0.08, "#606366"],
          [0.2, "#25272a"],
          [0.32, "#727476"],
          [0.5, "#34373b"],
          [0.62, "#18191a"],
          [0.74, "#797b7d"],
          [0.85, "#46494d"],
          [0.94, "#202224"],
          [1.0, "#878889"],
        ];
        for (const [p, c] of chromeStopsV) sweep.addColorStop(p, c);
        ctx.fillStyle = sweep;
        ctx.fillRect(bezelX, 0, bezelW, h);
        // Round the rib across its width: subtle crown, dark grooves at both edges.
        const crown = ctx.createLinearGradient(bezelX, 0, bezelX + bezelW, 0);
        crown.addColorStop(0.0, "rgba(0, 0, 0, 0.4)");
        crown.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
        crown.addColorStop(1.0, "rgba(0, 0, 0, 0.4)");
        ctx.fillStyle = crown;
        ctx.fillRect(bezelX, 0, bezelW, h);
      };
      drawGrille(-1);
      drawGrille(1);

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

      // The lens opening: clip everything here so the photo + glow can't spill past the
      // outer circle into the black housing.
      const lensR = R; // the visible outer circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
      ctx.clip();

      // --- Realistic lens: the HAL eye photo (app/eye.png) fills the opening, giving the
      // real glass dome + room reflections. A slight overscan makes the photo's dome reach
      // the chrome ring instead of leaving its own dark rim inside it. ---
      if (eyeReady) {
        const d = lensR * 2 * 1.1;
        ctx.drawImage(eyeImg, cx - d / 2, cy - d / 2, d, d);
      } else {
        // Fallback until the image loads: deep near-black glass.
        ctx.fillStyle = "#070708";
        ctx.beginPath();
        ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
        ctx.fill();
      }

      if (connectedRef.current) {
        // While connected the eye is alive: a reactive red glow + bloom + hot pupil burn
        // ADDITIVELY over the photo so the lens lights up and pulses with the voice. The
        // photo's own dim red is the resting look; speech drives these brighter. Agent
        // presence (gf) sets only the resting size; audio (act) inflates it toward the ring.
        const rest = 0.3 + 0.28 * gf; // ~0.40 (bot away) .. 0.58 (bot present), at rest
        const reach = clamp(rest + act * 1.0, rest, 0.98); // speech pushes out to the ring

        ctx.globalCompositeOperation = "lighter";

        // --- The red lens glow (additive, so the photo shows through at rest) ---
        const glowR = lensR * reach;
        const lens = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        lens.addColorStop(0, `hsla(${20 + hot * 30}, 100%, ${58 + hot * 28}%, 0.95)`);
        lens.addColorStop(0.18, `hsla(${4 + hot * 16}, 100%, ${40 + hot * 20}%, 0.7)`);
        lens.addColorStop(0.55, `hsla(0, 100%, ${22 + hot * 12}%, 0.36)`);
        lens.addColorStop(1, "hsla(0, 100%, 10%, 0)");
        ctx.fillStyle = lens;
        ctx.beginPath();
        ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
        ctx.fill();

        // --- Additive bloom ---
        const bloomR = lensR * clamp(reach - 0.05, 0.2, 0.96);
        const bloom = ctx.createRadialGradient(cx, cy, glowR * 0.3, cx, cy, bloomR);
        bloom.addColorStop(0, `hsla(2, 100%, 50%, ${0.12 + act * 0.4})`);
        bloom.addColorStop(1, "hsla(2, 100%, 50%, 0)");
        ctx.fillStyle = bloom;
        ctx.beginPath();
        ctx.arc(cx, cy, bloomR, 0, Math.PI * 2);
        ctx.fill();

        // --- The pupil: a bright hot core that pulses with the low end ---
        const pupilR = lensR * (0.09 + bassS * 0.26 + breathe * 0.03);
        const pupil = ctx.createRadialGradient(cx, cy, 0, cx, cy, pupilR);
        pupil.addColorStop(0, "rgba(255,255,245,0.98)");
        pupil.addColorStop(0.4, `hsla(${42 + hot * 10}, 100%, 70%, 0.92)`);
        pupil.addColorStop(1, "hsla(30, 100%, 55%, 0)");
        ctx.fillStyle = pupil;
        ctx.beginPath();
        ctx.arc(cx, cy, pupilR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Dormant: the phone isn't in the room. Dim the photo so the eye reads "resting"
        // (its baked-in red muted) until the agent joins and the glow above lights it up.
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.beginPath();
        ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
        ctx.fill();
      }

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
      className="h-full w-full"
      style={{ background: "#000000" }}
    />
  );
}
