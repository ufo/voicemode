"use client";

import { useEffect, useState } from "react";

interface GhostTextProps {
  text: string;
  // Characters revealed per tick and the tick interval (ms).
  charsPerTick?: number;
  tickMs?: number;
}

// Typewriter ("ghost typing") reveal. The displayed length walks toward text.length;
// when the segment grows (streaming transcription), the effect re-runs and keeps typing.
export default function GhostText({ text, charsPerTick = 1, tickMs = 22 }: GhostTextProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Clamp in case the segment text was replaced by something shorter.
    setCount((c) => Math.min(c, text.length));
    const id = setInterval(() => {
      setCount((c) => {
        const next = Math.min(text.length, c + charsPerTick);
        if (next >= text.length) clearInterval(id);
        return next;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [text, charsPerTick, tickMs]);

  const typing = count < text.length;
  return (
    <span className="font-ghost">
      {text.slice(0, count)}
      {typing && <span className="ghost-caret" aria-hidden="true" />}
    </span>
  );
}
