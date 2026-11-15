import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { AlertTriangle } from "lucide-react";

// The warning an agent sees before calling: the same customer is waiting for a call in another list, or was called in
// the last days from any of them (Ratings & Reviews, Surveys, Shakir Campaign). It informs — it does not block.

export type ContactSource = "reviews" | "surveys" | "shakir";
export const SOURCE_LABEL: Record<string, string> = { reviews: "Ratings & Reviews", surveys: "Surveys", shakir: "Shakir Campaign" };
const KW_MS = 3 * 60 * 60 * 1000;
const fmtDT = (ts?: string | null) => (ts ? new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "");
export const resultText = (s?: string | null) => (s ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");

interface Item { source: string; id: string; label: string | null; status: string | null; open: boolean; agent: string | null; contacted_at: string | null; result: string | null; contacted_by: string | null }

export default function OtherContacts({ phone, source, id }: { phone?: string | null; source: ContactSource; id?: string | null }) {
  const [d, setD] = useState<{ days: number; items: Item[] } | null>(null);
  useEffect(() => {
    setD(null);
    if (!phone || !id || String(phone).replace(/\D/g, "").length < 8) return;
    let alive = true;
    apiFetch(`/api/phone-contacts?${new URLSearchParams({ phone: String(phone), source, id })}`)
      .then((r) => (r.ok ? r.json() : null)).then((x) => { if (alive && x) setD(x); }).catch(() => { /* the warning is extra — the screen works without it */ });
    return () => { alive = false; };
  }, [phone, source, id]);
  if (!d || !d.items.length) return null;
  const called = d.items.filter((i) => i.contacted_at);
  const waiting = d.items.filter((i) => i.open && !i.contacted_at);
  return (
    <div className="p-3 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 text-xs space-y-1.5">
      <div className="flex items-center gap-2 font-extrabold text-amber-600"><AlertTriangle className="w-4 h-4 shrink-0" /> This customer is in other call lists too — check before you call</div>
      {called.map((i) => (
        <div key={i.source + i.id} className="text-[var(--text)]">
          <b>Called {fmtDT(i.contacted_at)}</b>{i.contacted_by ? ` by ${i.contacted_by}` : ""} in <b>{SOURCE_LABEL[i.source] || i.source}</b>{i.label ? ` (${i.label})` : ""}
          {i.result ? <> — result: <b>{resultText(i.result)}</b></> : null}{i.open ? <span className="text-amber-600 font-bold"> · still open there{i.agent ? ` with ${i.agent}` : ""}</span> : null}
        </div>
      ))}
      {waiting.map((i) => (
        <div key={i.source + i.id} className="text-[var(--text)]">
          <b>Waiting for a call</b> in <b>{SOURCE_LABEL[i.source] || i.source}</b>{i.label ? ` (${i.label})` : ""}{i.agent ? <> with <b>{i.agent}</b></> : " — no agent yet"}
        </div>
      ))}
      <div className="text-[10px] text-[var(--muted)]">Calls of the last {d.days} days and open tasks, matched on the phone number.</div>
    </div>
  );
}

// ---- the mark beside a number in a list (queue / my calls / reviews): the same warning, before the record is opened ----
export interface ContactFlag { waiting: string[]; called: { source: string; at: string; by: string | null; result: string | null }[] }

/** Asks once per list on screen which of its numbers are also in other call lists. */
export function useContactFlags(source: ContactSource, rows: { id: string; phone?: string | null }[]): Record<string, ContactFlag> {
  const [flags, setFlags] = useState<Record<string, ContactFlag>>({});
  const sig = rows.map((r) => r.id + ":" + (r.phone || "")).join("|");
  useEffect(() => {
    const items = rows.filter((r) => r.phone).map((r) => ({ id: r.id, phone: String(r.phone) }));
    if (!items.length) { setFlags({}); return; }
    let alive = true;
    apiFetch("/api/phone-contacts/flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, items }) })
      .then((r) => (r.ok ? r.json() : null)).then((x) => { if (alive && x) setFlags(x.flags || {}); }).catch(() => { /* extra information only */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sig]);
  return flags;
}

export function ContactFlagBadge({ flag }: { flag?: ContactFlag }) {
  if (!flag || (!flag.called.length && !flag.waiting.length)) return null;
  const last = flag.called[0];
  const lines = [
    ...flag.called.map((c) => `Called ${fmtDT(c.at)}${c.by ? ` by ${c.by}` : ""} in ${SOURCE_LABEL[c.source] || c.source}${c.result ? ` — ${resultText(c.result)}` : ""}`),
    ...flag.waiting.map((w) => `Waiting for a call in ${SOURCE_LABEL[w] || w}`),
  ];
  return (
    <div title={lines.join("\n")} className="mt-1 inline-flex items-start gap-1 px-2 py-0.5 rounded-lg text-[10px] leading-snug font-extrabold bg-amber-500/15 border border-amber-500/50 text-amber-600 max-w-[210px] whitespace-normal">
      <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
      <span>{last ? `Called ${fmtDT(last.at).slice(5)} · ${SOURCE_LABEL[last.source] || last.source}` : `Also in ${flag.waiting.map((w) => SOURCE_LABEL[w] || w).join(" + ")}`}
      {last && flag.waiting.length > 0 ? ` · also waiting in ${flag.waiting.map((w) => SOURCE_LABEL[w] || w).join(" + ")}` : ""}</span>
    </div>
  );
}
