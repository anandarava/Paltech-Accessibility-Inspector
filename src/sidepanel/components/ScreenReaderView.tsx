import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isMessage, sendToBackground } from "@shared/messages";
import { lineHasProblem, lineInView, transcriptText, type Transcript, type TranscriptLine, type TranscriptView } from "@shared/announce";
import { useStore } from "@src/sidepanel/store";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { Button } from "./Button";
import { BackButton } from "./BackButton";
import { LightbulbIcon, PlayIcon, RefreshIcon, ScreenReaderIcon } from "./icons";

const VIEWS: Array<{ value: TranscriptView; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "headings", label: "Headings" },
  { value: "landmarks", label: "Landmarks" },
  { value: "links", label: "Links" },
  { value: "forms", label: "Form fields" },
];

/** Speech rate: a little faster than default, still easy to follow for someone new to screen readers. */
const SPEECH_RATE = 1.2;

const KIND_STYLE: Record<TranscriptLine["kind"], string> = {
  landmark: "font-semibold text-violet-900",
  heading: "font-semibold text-slate-900",
  link: "text-blue-800",
  control: "text-slate-900",
  image: "text-slate-900",
  structure: "italic text-slate-700",
  text: "text-slate-800",
};

function isTranscript(v: unknown): v is Transcript {
  return typeof v === "object" && v !== null && Array.isArray((v as { lines?: unknown }).lines);
}

export function ScreenReaderView({ onBack }: { onBack(): void }) {
  const tabId = useStore((s) => s.tabId);
  const showToast = useStore((s) => s.showToast);
  const selectIssue = useStore((s) => s.selectIssue);
  const setView = useStore((s) => s.setView);
  const headingRef = useFocusHeading<HTMLHeadingElement>([]);

  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState<TranscriptView>("all");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const speakToken = useRef(0);
  const lineRefs = useRef(new Map<number, HTMLLIElement>());

  const stopSpeaking = useCallback(() => {
    speakToken.current++;
    window.speechSynthesis?.cancel();
    setSpeaking(null);
  }, []);

  const load = useCallback(async () => {
    if (tabId === null) return;
    stopSpeaking();
    setLoading(true);
    setError(null);
    const res = await sendToBackground<unknown>({ type: "SR_TRANSCRIPT", tabId });
    if (useStore.getState().tabId !== tabId) return;
    setLoading(false);
    if (!res.ok || !isTranscript(res.data)) {
      setError(res.error ?? "The page did not return a transcript.");
      return;
    }
    setTranscript(res.data);
    setStale(false);
    setSelected(null);
  }, [tabId, stopSpeaking]);

  // Read the page when the view opens or the tab changes; give the debugger back when it closes.
  useEffect(() => {
    if (tabId === null) return;
    setTranscript(null);
    void load();
    return () => {
      speakToken.current++;
      window.speechSynthesis?.cancel();
      void sendToBackground({ type: "SR_CLOSE", tabId });
      void sendToBackground({ type: "CLEAR_HIGHLIGHTS", tabId });
    };
  }, [tabId, load]);

  useEffect(() => {
    const listener = (raw: unknown): void => {
      if (isMessage(raw) && raw.type === "PAGE_CHANGED" && raw.tabId === tabId) setStale(true);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId]);

  const visible = useMemo(
    () => (transcript?.lines ?? []).filter((l) => lineInView(l, filter) && (!problemsOnly || lineHasProblem(l))),
    [transcript, filter, problemsOnly],
  );
  const problemCount = useMemo(() => (transcript?.lines ?? []).filter(lineHasProblem).length, [transcript]);

  const showLine = useCallback(
    async (line: TranscriptLine, quiet = false) => {
      if (tabId === null || !transcript) return;
      setSelected(line.index);
      const res = await sendToBackground({ type: "SR_HIGHLIGHT", tabId, source: transcript.source, nodeId: line.nodeId, backendNodeId: line.backendNodeId });
      if (!res.ok && !quiet) showToast({ kind: "error", message: res.error ?? "Could not show this element." });
    },
    [tabId, transcript, showToast],
  );

  const speakFrom = useCallback(
    (start: number) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        showToast({ kind: "error", message: "Speech is not available in this browser." });
        return;
      }
      synth.cancel();
      const queue = visible.filter((l) => l.index >= start);
      const token = ++speakToken.current;
      let i = 0;
      const next = (): void => {
        if (token !== speakToken.current) return;
        const line = queue[i++];
        if (!line) {
          setSpeaking(null);
          return;
        }
        setSpeaking(line.index);
        void showLine(line, true);
        const utterance = new SpeechSynthesisUtterance(line.text);
        utterance.rate = SPEECH_RATE;
        utterance.onend = next;
        utterance.onerror = () => {
          if (token === speakToken.current) setSpeaking(null);
        };
        synth.speak(utterance);
      };
      next();
    },
    [visible, showLine, showToast],
  );

  // Keep the line being spoken in view in the panel.
  useEffect(() => {
    if (speaking !== null) lineRefs.current.get(speaking)?.scrollIntoView({ block: "nearest" });
  }, [speaking]);

  const copy = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcriptText(transcript, visible));
      showToast({ kind: "success", message: `Copied ${visible.length} ${visible.length === 1 ? "line" : "lines"}.` });
    } catch {
      showToast({ kind: "error", message: "Could not copy the transcript." });
    }
  };

  const openIssue = (id: string) => {
    selectIssue(id);
    setView("detail");
  };

  const startAt = selected !== null && visible.some((l) => l.index === selected) ? selected : (visible[0]?.index ?? 0);

  return (
    <section aria-labelledby="reader-heading" className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-b from-blue-50/60 to-white">
      <div className="px-3 pt-3">
        <BackButton onClick={onBack} ariaLabel="Back to issue list" />
      </div>

      <div className="px-3 py-3 text-sm text-slate-800">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <ScreenReaderIcon size={18} />
            </span>
            <h2 id="reader-heading" ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900">
              Screen reader
            </h2>
          </div>
          <p className="mt-2.5 text-slate-700">
            What a screen reader announces on this page, in reading order: each item's role, name and state (WCAG 1.1.1, 1.3.1, 2.4.6, 4.1.2).
          </p>
          <div className="mt-3 flex gap-2.5 rounded-lg border border-blue-200 bg-blue-100/70 p-3">
            <LightbulbIcon size={18} className="mt-0.5 text-blue-700" />
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-800">
              <li>Click a line to show its element on the page.</li>
              <li>
                <strong>Speak</strong> reads the lines aloud from the selected one.
              </li>
              <li>Lines marked ⚠ have a problem a screen reader user would run into.</li>
            </ul>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {speaking === null ? (
              <Button variant="primary" onClick={() => speakFrom(startAt)} disabled={!visible.length || loading} className="flex-1 py-2">
                <PlayIcon size={12} /> Speak
              </Button>
            ) : (
              <Button variant="danger" onClick={stopSpeaking} className="flex-1 py-2">
                Stop speaking
              </Button>
            )}
            <Button onClick={() => void load()} disabled={tabId === null || loading}>
              <RefreshIcon /> {loading ? "Reading…" : "Refresh"}
            </Button>
          </div>
        </div>

        <div aria-live="polite" className="mt-2 text-xs">
          {stale && transcript && !loading && (
            <p className="rounded-md border border-amber-700 bg-amber-50 p-2 text-amber-900">
              The page changed since this was read.{" "}
              <button type="button" className="font-semibold underline" onClick={() => void load()}>
                Refresh
              </button>
            </p>
          )}
          {error && <p className="rounded-md border border-red-700 bg-red-50 p-2 text-red-900">{error}</p>}
        </div>

        {transcript && (
          <div className="mt-3 rounded-xl border border-blue-200 bg-white p-3.5">
            {transcript.source === "html" ? (
              <p className="mb-2 rounded-md border border-amber-700 bg-amber-50 p-2 text-xs text-amber-900">
                <strong>Approximate:</strong> built from the page's HTML, because Chrome's accessibility tree could not be read (the debugging bar was closed, or
                Chrome does not allow it on this page).
              </p>
            ) : (
              <p className="mb-2 text-xs text-slate-700">From Chrome's accessibility tree: the information screen readers get. Wording is close to NVDA.</p>
            )}
            {transcript.truncated && <p className="mb-2 text-xs text-amber-900">The page is very large; only the first part is shown.</p>}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                Show
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as TranscriptView)}
                  className="rounded-md border border-slate-400 bg-white px-2 py-1 text-xs font-normal text-slate-900"
                >
                  {VIEWS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-800">
                <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
                Only lines with problems
              </label>
              <span className="flex-1" />
              <Button size="sm" onClick={() => void copy()} disabled={!visible.length}>
                Copy
              </Button>
            </div>

            <p className="mt-2 text-xs text-slate-700">
              {visible.length} {visible.length === 1 ? "line" : "lines"} · {problemCount} with problems
            </p>

            {visible.length === 0 ? (
              <p className="mt-2 text-sm text-slate-700">Nothing to show for this view.</p>
            ) : (
              <ol aria-label="Transcript" className="mt-2 text-sm">
                {visible.map((line) => {
                  const problem = lineHasProblem(line);
                  const current = speaking === line.index;
                  return (
                    <li
                      key={line.index}
                      ref={(el) => {
                        if (el) lineRefs.current.set(line.index, el);
                        else lineRefs.current.delete(line.index);
                      }}
                      className={`border-b border-slate-200 py-1 ${current ? "bg-yellow-100" : selected === line.index ? "bg-blue-50" : ""} ${problem ? "border-l-4 border-l-amber-600" : ""}`}
                      style={{ paddingLeft: `${Math.min(line.depth, 5) * 12 + (problem ? 4 : 8)}px` }}
                    >
                      <button
                        type="button"
                        onClick={() => void showLine(line)}
                        aria-current={current ? "true" : undefined}
                        className={`flex w-full gap-2 rounded text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 ${KIND_STYLE[line.kind]}`}
                      >
                        <span className="w-7 shrink-0 text-right text-xs tabular-nums text-slate-600">{line.index + 1}</span>
                        <span className="min-w-0 break-words">{line.text}</span>
                      </button>
                      {problem && (
                        <ul className="ml-9 mt-0.5 space-y-0.5 text-xs">
                          {line.problems.map((p) => (
                            <li key={p.code} className="text-amber-900">
                              <span aria-hidden="true">⚠ </span>
                              {p.message}
                            </li>
                          ))}
                          {line.issues.map((i) => (
                            <li key={i.id}>
                              <button type="button" onClick={() => openIssue(i.id)} className="text-left text-amber-900 underline hover:text-amber-950">
                                <span aria-hidden="true">⚠ </span>
                                {i.ruleId}: {i.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {loading && !transcript && <p className="mt-3 text-sm text-slate-700">Reading the page…</p>}

        <p className="mt-3 text-xs text-slate-700">
          This is a simulation. NVDA, JAWS and VoiceOver word things a little differently; check critical flows with a real screen reader too.
        </p>
      </div>
    </section>
  );
}
