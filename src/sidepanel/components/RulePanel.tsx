import { useState, type ReactNode } from "react";
import type { Issue } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { sendToPage } from "@src/sidepanel/hooks/messaging";
import { Button } from "./Button";
import { ReasonForm } from "./ReasonForm";
import { StatusLabel } from "./SeverityLabel";
import { CheckIcon, EyeIcon, InfoCircleIcon, LightbulbIcon } from "./icons";

interface Props {
  /** All instances of the rule in the list (at least one). */
  issues: Issue[];
  /** The instance the buttons act on. */
  selected: Issue;
  /** Opens the full IssueDetail view for an issue. */
  onOpen(issueId: string): void;
  /** Instance rows (only passed when the rule has several instances). */
  children?: ReactNode;
}

/**
 * Body of an expanded rule card: the rule-level "Issue" and "Suggested fix" once,
 * the instance rows, and the actions for the selected instance. "Mark as reviewed"
 * is the existing Ignore flow (ReasonForm, then IGNORE_ADD) under a friendlier name.
 */
export function RulePanel({ issues, selected, onOpen, children }: Props) {
  const tabId = useStore((s) => s.tabId);
  const readOnly = useStore((s) => s.viewingSaved !== null);
  const selectIssue = useStore((s) => s.selectIssue);
  const updateIssues = useStore((s) => s.updateIssues);
  const showToast = useStore((s) => s.showToast);
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState<"view" | "ignore" | null>(null);

  const first = issues[0];
  const description = first.description || selected.description;
  const canReview = !readOnly && selected.status === "new";

  const viewElement = async () => {
    if (tabId === null) return;
    selectIssue(selected.id);
    setBusy("view");
    const res = await sendToPage(tabId, { type: "HIGHLIGHT_ISSUE", tabId, issueId: selected.id });
    setBusy(null);
    if (!res.ok) showToast({ kind: "error", message: `Could not locate element: ${res.error ?? "no response from page"}` });
  };

  const submitReason = async (reason: string) => {
    if (tabId === null) return;
    setBusy("ignore");
    const res = await sendToBackground({ type: "IGNORE_ADD", tabId, issueIds: [selected.id], reason });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not ignore issue: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    updateIssues((i) => (i.id === selected.id ? { ...i, status: "ignored", reason } : i));
    setForm(false);
    showToast({ kind: "success", message: "Issue marked as reviewed (ignored for this origin)." });
    // The card may leave the list (the default filter shows open issues only); keep focus on the list heading then.
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) document.getElementById("issues-heading")?.focus();
    }, 60);
  };

  return (
    <div className="space-y-2.5 border-t border-blue-100 bg-blue-50 px-3 py-2.5 text-slate-900">
      <section aria-label="Issue">
        <h4 className="flex items-center gap-1.5 text-[13px] font-bold">
          <InfoCircleIcon size={16} /> Issue
        </h4>
        <p className="mt-1 pl-[22px] leading-relaxed text-slate-800">{description || first.title}</p>
      </section>

      <section aria-label="Suggested fix">
        <h4 className="flex items-center gap-1.5 text-[13px] font-bold">
          <LightbulbIcon size={16} className="text-amber-700" /> Suggested fix
        </h4>
        <p className="mt-1 ml-[22px] rounded-md border border-blue-200 bg-white px-2 py-1.5 leading-relaxed text-slate-900">{first.fix.summary}</p>
      </section>

      {issues.length === 1 && selected.status !== "new" && (
        <p className="pl-[22px]">
          <StatusLabel status={selected.status} />
        </p>
      )}

      {children}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void viewElement()} disabled={tabId === null || readOnly || busy === "view"}>
          <EyeIcon /> View element
        </Button>
        {canReview && (
          <Button onClick={() => setForm((f) => !f)} aria-expanded={form} disabled={tabId === null}>
            <CheckIcon /> Mark as reviewed
          </Button>
        )}
        <Button variant="ghost" onClick={() => onOpen(selected.id)} className="ml-auto">
          More details
        </Button>
      </div>

      {form && canReview && (
        <ReasonForm
          title="Mark as reviewed"
          description="Reviewed issues are ignored for this origin and excluded from the totals and score. Explain why (e.g. false positive)."
          submitLabel="Mark as reviewed"
          busy={busy === "ignore"}
          onSubmit={(reason) => void submitReason(reason)}
          onCancel={() => setForm(false)}
        />
      )}
    </div>
  );
}
