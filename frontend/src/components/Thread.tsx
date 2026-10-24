// The chat column: the list of messages, the current step's card (pick a part, confirm the
// setup, results) at the bottom, and the box where the user types a request.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  /** The stage card (upload, confirmation, results) rendered at the end of the thread. */
  children?: ReactNode;
  // Changes when a different card appears (App passes the stage name). The thread scrolls
  // only when this or the message count changes, never when the card re-draws in place.
  scrollKey: string;
  // True while the AI is working. Shows the typing dots and locks the input.
  busy: boolean;
  // False until a part is loaded, because there is nothing to describe before that.
  canSend: boolean;
  placeholder: string;
  // Sample request for the "Try:" button.
  example: string;
  onSend: (text: string) => void;
}

export function Thread({ messages, children, scrollKey, busy, canSend, placeholder, example, onSend }: Props) {
  // What the user has typed so far.
  const [draft, setDraft] = useState("");
  // An empty marker at the bottom of the list. Scrolling it into view scrolls to the end.
  const endRef = useRef<HTMLDivElement>(null);
  // The box around the current card, so a new card can be scrolled to its top.
  const cardRef = useRef<HTMLDivElement>(null);

  // Keep the newest message or card in view. This runs when a message arrives or a different
  // card appears. It must not depend on `children`: that is a new object on every redraw, and
  // every hover over a row redraws the app, which used to yank the scroll position to the bottom
  // while the user was reading a long card.
  useEffect(() => {
    if (cardRef.current) {
      // A card is showing. Line up its top edge so the user starts reading from the top.
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, scrollKey]);

  // Sends the draft, unless it is blank or the app is not ready for input.
  const submit = () => {
    const text = draft.trim();
    if (!text || !canSend || busy) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="thread">
      <div className="thread-scroll">
        {messages.map((m) => (
          // The role (user, assistant, or system) picks the style, for example msg-user.
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.text}
          </div>
        ))}
        {/* Three animated dots, shown while waiting for the AI. */}
        {busy && (
          <div className="msg msg-assistant typing" aria-live="polite">
            <span /> <span /> <span />
          </div>
        )}
        {/* Only add the wrapper when there is a card, so an empty box does not add a gap. */}
        {children && <div ref={cardRef}>{children}</div>}
        <div ref={endRef} />
      </div>

      <div className="composer">
        {/* The "Try:" button appears only when the box is empty. Clicking it fills in the
            sample request. */}
        {canSend && !busy && draft === "" && (
          <button className="example" onClick={() => setDraft(example)}>
            Try: "{example}"
          </button>
        )}
        <div className="composer-row">
          <textarea
            value={draft}
            rows={2}
            placeholder={placeholder}
            disabled={!canSend || busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends. Shift+Enter adds a new line, as in most chat apps.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className="primary send" disabled={!draft.trim() || !canSend || busy} onClick={submit}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
