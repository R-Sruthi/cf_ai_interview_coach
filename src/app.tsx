import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import type { ChatAgent, CoachState } from "./server";
import { WEAK_THRESHOLD, type Difficulty, type Problem } from "./problems";
import { formatScore } from "./format";
import { ProgressPanel } from "./components/ProgressPanel";
import { ProblemCard } from "./components/ProblemCard";
import { WelcomeCard } from "./components/WelcomeCard";
import {
  Badge,
  Button,
  InputArea,
  PoweredByCloudflare,
  Switch,
  Text
} from "@cloudflare/kumo";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  BugIcon,
  ShuffleIcon,
  CheckCircleIcon,
  ChartBarIcon,
  BellRingingIcon,
  XIcon
} from "@phosphor-icons/react";

const NUDGE_PREFIX = "**Revision reminder:**";

// Nudges carry metadata.kind = "nudge"; the text check covers older messages.
function isNudge(message: UIMessage): boolean {
  const meta = message.metadata as { kind?: string } | undefined;
  return (
    meta?.kind === "nudge" ||
    message.parts.some(
      (p) => p.type === "text" && p.text.startsWith(NUDGE_PREFIX)
    )
  );
}

// ── User identity ─────────────────────────────────────────────────────

// One Durable Object per user: the agent instance is named by a random id
// kept in localStorage.
function getUserId(): string {
  try {
    const existing = localStorage.getItem("coach-user-id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem("coach-user-id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

// ── Main chat ─────────────────────────────────────────────────────────

function Chat() {
  const [userId] = useState(getUserId);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [busy, setBusy] = useState<"problem" | "submit" | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toasts = useKumoToastManager();

  const agent = useAgent<ChatAgent, CoachState>({
    agent: "ChatAgent",
    name: userId,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    )
  });

  const { messages, sendMessage, clearHistory, stop, status } = useAgentChat({
    agent,
    experimental_throttle: 100
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const grading = agent.state?.grading;
  const isGrading = grading?.status === "grading";
  const topicStats = agent.state?.topicStats ?? [];
  const history = agent.state?.history ?? [];
  const weakTopics = topicStats.filter((s) => s.avgScore < WEAK_THRESHOLD);

  // Restore the active problem after a reload or reconnect.
  useEffect(() => {
    if (!connected) return;
    agent.stub
      .getCurrentProblem()
      .then(setProblem)
      .catch((e: unknown) => console.error("getCurrentProblem failed:", e));
  }, [connected, agent]);

  // Grading runs in a Workflow; its progress arrives through agent state sync.
  useEffect(() => {
    // Re-fetch rather than clear: a stale "done" from an earlier submission
    // must not hide a problem started since.
    if (grading?.status === "done") {
      agent.stub
        .getCurrentProblem()
        .then(setProblem)
        .catch((e: unknown) => console.error("getCurrentProblem failed:", e));
    }
    if (grading?.status === "error") {
      toasts.add({
        title: "Grading failed",
        description: grading.error ?? "Try submitting again."
      });
    }
  }, [agent, grading?.status, grading?.sessionId, grading?.error, toasts]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Re-focus the input after streaming ends
  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const showError = useCallback(
    (title: string, e: unknown) => {
      toasts.add({
        title,
        description: e instanceof Error ? e.message : String(e)
      });
    },
    [toasts]
  );

  const newProblem = useCallback(async () => {
    setBusy("problem");
    try {
      setProblem(await agent.stub.getNextProblem(difficulty));
    } catch (e) {
      showError("Couldn't load a problem", e);
    } finally {
      setBusy(null);
    }
  }, [agent, difficulty, showError]);

  const submitAndGrade = useCallback(async () => {
    setBusy("submit");
    try {
      await agent.stub.submitAndGrade();
    } catch (e) {
      showError("Grading failed", e);
    } finally {
      setBusy(null);
    }
  }, [agent, showError]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated relative">
      {/* Header */}
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-kumo-default">
              DSA Interview Coach
            </h1>
            <Badge variant="secondary">
              <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
              Llama 3.3
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <div className="flex items-center gap-1.5">
              <BugIcon size={14} className="text-kumo-inactive" />
              <Switch
                checked={showDebug}
                onCheckedChange={setShowDebug}
                size="sm"
                aria-label="Toggle debug mode"
              />
            </div>
            <ThemeToggle />
            <Button
              variant="secondary"
              icon={<ChartBarIcon size={16} />}
              onClick={() => setShowProgress(true)}
              className="lg:hidden"
            >
              Progress
            </Button>
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={clearHistory}
            >
              Clear
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <main className="flex flex-col flex-1 min-w-0">
          {/* Problem controls */}
          <div className="px-5 py-3 bg-kumo-base border-b border-kumo-line">
            <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                <Text size="xs" variant="secondary">
                  Weak topics:
                </Text>
                {weakTopics.length > 0 ? (
                  weakTopics.map((s) => (
                    <Badge key={s.topic} variant="outline">
                      {s.topic} · {formatScore(s.avgScore)}
                    </Badge>
                  ))
                ) : (
                  <Text size="xs" variant="secondary">
                    none yet
                  </Text>
                )}
              </div>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                aria-label="Difficulty"
                className="px-2 py-1.5 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              <Button
                variant="secondary"
                icon={<ShuffleIcon size={16} />}
                onClick={newProblem}
                disabled={
                  !connected || busy !== null || isStreaming || isGrading
                }
              >
                {busy === "problem" ? "Loading..." : "New problem"}
              </Button>
              <Button
                variant="primary"
                icon={<CheckCircleIcon size={16} />}
                onClick={submitAndGrade}
                disabled={
                  !connected ||
                  !problem ||
                  busy !== null ||
                  isStreaming ||
                  isGrading
                }
              >
                {isGrading || busy === "submit"
                  ? "Grading..."
                  : "Submit & grade"}
              </Button>
            </div>
          </div>

          {problem && (
            <div className="px-5 pt-3">
              <div className="max-w-3xl mx-auto">
                <ProblemCard problem={problem} collapsed={isGrading} />
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
              {messages.length === 0 && <WelcomeCard />}

              {messages.map((message: UIMessage, index: number) => {
                const isUser = message.role === "user";
                const nudge = !isUser && isNudge(message);
                const isLastAssistant =
                  message.role === "assistant" && index === messages.length - 1;

                return (
                  <div key={message.id} className="space-y-2">
                    {showDebug && (
                      <pre className="text-[11px] text-kumo-subtle bg-kumo-control rounded-lg p-3 overflow-auto max-h-64">
                        {JSON.stringify(message, null, 2)}
                      </pre>
                    )}

                    {message.parts.map((part, i) => {
                      const key = `${message.id}-${i}`;
                      if (part.type !== "text" || !part.text) return null;

                      if (isUser) {
                        return (
                          <div key={key} className="flex justify-end">
                            <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                              {part.text}
                            </div>
                          </div>
                        );
                      }

                      if (nudge) {
                        return (
                          <div key={key} className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-kumo-warning bg-kumo-warning-tint text-kumo-default leading-relaxed">
                              <div className="flex items-center gap-1.5 px-3 pt-2.5 text-kumo-warning">
                                <BellRingingIcon size={14} weight="bold" />
                                <span className="text-xs font-semibold uppercase tracking-wide">
                                  Revision reminder
                                </span>
                              </div>
                              <Streamdown
                                className="sd-theme px-3 pb-3 pt-1"
                                controls={false}
                              >
                                {part.text.replace(NUDGE_PREFIX, "").trim()}
                              </Streamdown>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={key} className="flex justify-start">
                          <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                            <Streamdown
                              className="sd-theme rounded-2xl rounded-bl-md p-3"
                              plugins={{ code }}
                              controls={false}
                              isAnimating={isLastAssistant && isStreaming}
                            >
                              {part.text}
                            </Streamdown>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-kumo-line bg-kumo-base">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="max-w-3xl mx-auto px-5 py-4"
            >
              <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
                <InputArea
                  ref={textareaRef}
                  value={input}
                  onValueChange={setInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  placeholder="Explain your approach..."
                  disabled={!connected || isStreaming}
                  rows={1}
                  className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
                />
                {isStreaming ? (
                  <Button
                    type="button"
                    variant="secondary"
                    shape="square"
                    aria-label="Stop generation"
                    icon={<StopIcon size={18} />}
                    onClick={stop}
                    className="mb-0.5"
                  />
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    shape="square"
                    aria-label="Send message"
                    disabled={!input.trim() || !connected}
                    icon={<PaperPlaneRightIcon size={18} />}
                    className="mb-0.5"
                  />
                )}
              </div>
            </form>
            <div className="flex justify-center pb-3">
              <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
            </div>
          </div>
        </main>

        {/* Progress: right column on large screens */}
        <aside className="hidden lg:block w-80 shrink-0 overflow-y-auto border-l border-kumo-line bg-kumo-base p-5">
          <ProgressPanel topicStats={topicStats} history={history} />
        </aside>
      </div>

      {/* Progress: slide-over drawer on small screens */}
      {showProgress && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close progress"
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowProgress(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[85%] max-w-sm overflow-y-auto bg-kumo-base p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <Text variant="heading3" as="h2">
                Progress
              </Text>
              <Button
                variant="ghost"
                shape="square"
                aria-label="Close progress"
                icon={<XIcon size={16} />}
                onClick={() => setShowProgress(false)}
              />
            </div>
            <ProgressPanel topicStats={topicStats} history={history} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Toasty>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen text-kumo-inactive">
            Loading...
          </div>
        }
      >
        <Chat />
      </Suspense>
    </Toasty>
  );
}
