import GhostText from "@/components/GhostText";
import useCombinedTranscriptions from "@/hooks/useCombinedTranscriptions";
import * as React from "react";

export default function TranscriptionView() {
  const combinedTranscriptions = useCombinedTranscriptions();
  const containerRef = React.useRef<HTMLDivElement>(null);

  // scroll to bottom when new transcription is added
  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [combinedTranscriptions]);

  return (
    <div className="ghost-panel relative h-[220px] w-full rounded-md overflow-hidden">
      {/* Fade-out gradient mask (matches the panel's dark-blue background) */}
      <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-[var(--ghost-panel-bg)] to-transparent z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--ghost-panel-bg)] to-transparent z-10 pointer-events-none" />

      {/* Scrollable content */}
      <div
        ref={containerRef}
        className="ghost-screen-text h-full flex flex-col gap-2 overflow-y-auto px-4 py-8"
      >
        {combinedTranscriptions.map((segment) => (
          <div
            id={segment.id}
            key={segment.id}
            className={
              segment.role === "assistant"
                ? "p-2 self-start fit-content"
                : "ghost-user-segment rounded-md p-2 self-end fit-content"
            }
          >
            {segment.role === "assistant" ? <GhostText text={segment.text} /> : segment.text}
          </div>
        ))}
      </div>
    </div>
  );
}
