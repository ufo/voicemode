import GhostText from "@/components/GhostText";
import useCombinedTranscriptions from "@/hooks/useCombinedTranscriptions";
import * as React from "react";

export default function TranscriptionView({ connected }: { connected: boolean }) {
  const combinedTranscriptions = useCombinedTranscriptions();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const lastIndex = combinedTranscriptions.length - 1;

  // scroll to bottom when new transcription is added
  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [combinedTranscriptions]);

  return (
    <div className="ghost-panel relative flex-1 min-h-0 w-full rounded-md overflow-hidden">
      {/* Fade-out gradient mask (matches the panel's dark-blue background) */}
      <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-[var(--ghost-panel-bg)] to-transparent z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-[var(--ghost-panel-bg)] to-transparent z-10 pointer-events-none" />

      {/* Scrollable content */}
      <div
        ref={containerRef}
        className="ghost-screen-text h-full flex flex-col gap-2 overflow-y-auto px-2 pt-6 pb-2"
      >
        {combinedTranscriptions.map((segment, index) => {
          // The console's resting cursor lives after the last word of the most recent
          // segment (only while connected). Assistant segments hand the caret to GhostText
          // so it stays put once typing finishes; user segments append it inline.
          const isLast = index === lastIndex;
          const userCaret = connected && isLast;
          return (
            <div
              id={segment.id}
              key={segment.id}
              className={
                segment.role === "assistant"
                  ? "p-2 self-start max-w-[92%]"
                  : "ghost-user-segment rounded-md p-2 self-end max-w-[92%] text-right"
              }
            >
              {segment.role === "assistant" ? (
                <GhostText text={segment.text} showCaret={connected && isLast} />
              ) : (
                <>
                  {segment.text}
                  {userCaret && <span className="ghost-caret" aria-hidden="true" />}
                </>
              )}
            </div>
          );
        })}
        {/* Connected but nothing said yet: a lone resting cursor at the start of the console. */}
        {connected && combinedTranscriptions.length === 0 && (
          <div className="font-ghost self-start p-2">
            <span className="ghost-caret" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}
