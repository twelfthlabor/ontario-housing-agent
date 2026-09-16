"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

type ToolChip = {
  id: string;
  name: string;
  label: string;
  summary?: string;
  done: boolean;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  tools: ToolChip[];
  cached: boolean;
  pending: boolean;
};

const SUGGESTIONS = [
  { title: "Get to know a city", question: "What is the median asking price in Ottawa?", detail: "Explore Ottawa’s asking prices", icon: "pin" },
  { title: "Compare your options", question: "Compare Hamilton and Kitchener", detail: "Hamilton or Kitchener?", icon: "compare" },
  { title: "Find room to grow", question: "Cheapest 3-bed listings in Mississauga", detail: "3-bedroom listings in Mississauga", icon: "home" },
] as const;

const ERROR_TEXT: Record<string, string> = {
  provider_error: "The answer service is temporarily unavailable. Please try again in a moment.",
  misconfigured: "This demo is not configured with an LLM provider right now.",
  rate_limited: "Too many requests. Please try again shortly.",
  budget_exhausted: "The demo has reached its daily LLM budget. Please try again tomorrow.",
};

/** "st-catharines" -> "St-Catharines" for readable tool chips. */
function displayCity(value: string): string {
  return value
    .split(/([-\s])/)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("");
}

function toolLabel(name: string, args: unknown): string {
  let suffix = "";
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    if (typeof record.city === "string") {
      suffix = displayCity(record.city);
    } else if (Array.isArray(record.cities)) {
      suffix = record.cities
        .filter((city): city is string => typeof city === "string")
        .map(displayCity)
        .join(", ");
    }
  }
  const friendlyName = ({ city_snapshot: "City snapshot", compare_cities: "City comparison", search_listings: "Listing search" } as Record<string, string>)[name] ?? "Sample lookup";
  return suffix ? `${friendlyName} · ${suffix}` : friendlyName;
}

function updateLastAssistant(
  messages: Message[],
  update: (message: Message) => Message,
): Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      const next = [...messages];
      next[index] = update(next[index]);
      return next;
    }
  }
  return messages;
}

function emptyMessage(role: Message["role"]): Message {
  return { role, content: "", tools: [], cached: false, pending: false };
}

export default function Chat({ offline, draft }: { offline: boolean; draft: { text: string; id: number } | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!draft) return;
    setInput(draft.text);
    inputRef.current?.focus();
    composerRef.current?.scrollIntoView({ block: "nearest" });
  }, [draft]);

  // Keep streamed replies visible without pulling the page away from a city
  // snapshot the visitor may be exploring at the same time.
  useEffect(() => {
    const pane = messagesRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;

    setInput("");
    setError(null);
    setBusy(true);

    const outgoing = [
      ...messages.map((message) => ({ role: message.role, content: message.content })),
      { role: "user" as const, content: text },
    ].slice(-20);

    setMessages((prev) => [
      ...prev,
      { ...emptyMessage("user"), content: text },
      { ...emptyMessage("assistant"), pending: true },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: outgoing }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          retry_after_s?: number;
        } | null;
        if (data?.error === "rate_limited") {
          setError(`Rate limit reached. Try again in ${data.retry_after_s ?? 60} seconds.`);
        } else if (data?.error === "budget_exhausted") {
          setError("The demo has used its daily LLM budget. Try again tomorrow.");
        } else {
          setError("The agent could not start. Please try again.");
        }
        setMessages((prev) => [...prev.slice(0, -2), { ...emptyMessage("user"), content: text }]);
        return;
      }

      if (!response.body) throw new Error("stream missing");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleFrame = (frame: string) => {
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }

          switch (event.type) {
            case "text":
              if (typeof event.delta === "string") {
                const delta = event.delta;
                setMessages((prev) =>
                  updateLastAssistant(prev, (message) => ({
                    ...message,
                    content: message.content + delta,
                    pending: true,
                  })),
                );
              }
              break;
            case "tool": {
              const name = typeof event.name === "string" ? event.name : "tool";
              const label = toolLabel(name, event.args);
              setMessages((prev) =>
                updateLastAssistant(prev, (message) => ({
                  ...message,
                  tools: [
                    ...message.tools,
                    { id: `${name}-${message.tools.length}`, name, label, done: false },
                  ],
                })),
              );
              break;
            }
            case "tool_result":
              setMessages((prev) =>
                updateLastAssistant(prev, (message) => {
                  const tools = [...message.tools];
                  for (let index = tools.length - 1; index >= 0; index -= 1) {
                    if (!tools[index].done) {
                      tools[index] = {
                        ...tools[index],
                        done: true,
                        summary: typeof event.summary === "string" ? event.summary : undefined,
                      };
                      break;
                    }
                  }
                  return { ...message, tools };
                }),
              );
              break;
            case "cached":
              setMessages((prev) => updateLastAssistant(prev, (message) => ({ ...message, cached: true })));
              break;
            case "error": {
              const code = typeof event.code === "string" ? event.code : "provider_error";
              setError(ERROR_TEXT[code] ?? ERROR_TEXT.provider_error);
              break;
            }
            case "done":
              setMessages((prev) =>
                updateLastAssistant(prev, (message) => ({ ...message, pending: false })),
              );
              break;
            default:
              break;
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          handleFrame(frame);
        }
      }
      if (buffer.trim()) handleFrame(buffer);
    } catch {
      setError("Connection lost. Please try again.");
    } finally {
      setBusy(false);
      setMessages((prev) =>
        updateLastAssistant(prev, (message) => ({ ...message, pending: false })),
      );
    }
  }

  return (
    <section className="chat" aria-label="Chat with the housing agent">
      <div className="chat-heading"><span>{offline ? "Offline demo" : "Sample-based assistant"}</span><button className="new-chat" type="button" aria-label="New chat" disabled={busy || messages.length === 0} onClick={() => { setMessages([]); setInput(""); setError(null); inputRef.current?.focus(); }}><Icon name="plus" />New chat</button></div>
      {offline ? <p className="demo-notice">Scripted answers from the sample. Budget filters and follow-up questions need the live model.</p> : null}
      <div className="messages" ref={messagesRef} role="log" aria-live="polite">
        {messages.length === 0 ? <div className="chat-empty"><span className="chat-empty-mark"><Icon name="chat" /></span><h2>A closer look.</h2><p>Ask about a city’s asking prices,<br />or put two places side by side.</p></div> : null}
        {messages.map((message, index) => <div className={`msg msg-${message.role}`} key={`${message.role}-${index}`}>
          <span className="message-author">{message.role === "user" ? "You" : "Housing agent"}</span>
          {message.tools.length > 0 ? <div className="tool-chips">{message.tools.map(tool => <span className={`tool-chip${tool.done ? " done" : ""}`} key={tool.id} title={tool.summary}><span className="dot" aria-hidden="true" />{tool.label}</span>)}</div> : null}
          {message.content || message.pending ? <div className="bubble">{message.content}{message.pending && !message.content ? <span className="thinking" role="status"><span /><span /><span /><span className="sr-only">Checking the sample</span></span> : null}</div> : null}
          {message.cached ? <span className="cached-note">Cached answer</span> : null}
        </div>)}
      </div>
      {messages.length === 0 ? <div className="suggestions" aria-label="Suggested questions">{SUGGESTIONS.slice(0, 2).map(({ question, title, icon }) => <button className="question-suggestion" type="button" disabled={busy} key={question} onClick={() => void send(question)}><Icon name={icon} /><span>{title}</span><Icon name="arrow" /></button>)}</div> : null}
      {error ? <p className="error" ref={errorRef} role="alert">{error}</p> : null}
      <form className="composer" ref={composerRef} onSubmit={event => { event.preventDefault(); void send(input); }}>
        <label className="sr-only" htmlFor="question">Your question</label>
        <textarea ref={inputRef} autoComplete="off" id="question" rows={3} maxLength={4000} placeholder="Ask about Ontario housing…" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); } }} />
        <div className="composer-bottom"><span>From the research sample</span><button type="submit" aria-label={busy ? "Thinking" : "Send question"} disabled={busy || !input.trim()}><Icon name="send" /></button></div>
      </form>
      <p className="composer-hint">Enter to send · Shift + Enter for a new line</p>
    </section>
  );
}
