import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { Ban } from "lucide-react";

// Cancelled / rejected orders, from our GrubTech order archive (looked up by the order number). The agent sees the mark
// before calling and closes the task themself — nothing is closed automatically. An order the archive does not hold
// simply has no mark, so "no mark" does not prove the order went through.

export interface CancelledInfo { group: "canceled" | "rejected"; reason?: string; stage?: string }
const norm = (v?: string | null) => String(v ?? "").trim();

/** Asks once per list on screen which of its order numbers were cancelled or rejected. Keyed by order number. */
export function useCancelledOrders(orderNos: (string | null | undefined)[]): Record<string, CancelledInfo> {
  const [map, setMap] = useState<Record<string, CancelledInfo>>({});
  const nos = [...new Set(orderNos.map(norm).filter(Boolean))].sort();
  const sig = nos.join("|");
  useEffect(() => {
    if (!nos.length) { setMap({}); return; }
    let alive = true;
    apiFetch("/api/orders/cancelled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders: nos }) })
      .then((r) => (r.ok ? r.json() : null)).then((x) => { if (alive && x) setMap(x.cancelled || {}); }).catch(() => { /* extra information only */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return map;
}
export const cancelledOf = (map: Record<string, CancelledInfo>, orderNo?: string | null): CancelledInfo | undefined => map[norm(orderNo)];
const word = (i: CancelledInfo) => (i.group === "rejected" ? "rejected" : "cancelled");

/** The small red mark beside an order number in a list. */
export function CancelledOrderBadge({ info }: { info?: CancelledInfo }) {
  if (!info) return null;
  return (
    <div title={`This order was ${word(info)}${info.reason ? ` — ${info.reason}` : ""} (GrubTech)`}
      className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/15 border border-rose-500/50 text-rose-500 whitespace-nowrap">
      <Ban className="w-3 h-3 shrink-0" /> Order {word(info)}
    </div>
  );
}

/** The red banner on a work screen. `how` says how to close the task there. */
export function CancelledOrderBanner({ info, orderNo, how }: { info?: CancelledInfo; orderNo?: string | null; how: string }) {
  if (!info) return null;
  return (
    <div className="p-3 rounded-xl border-2 border-rose-500 bg-rose-600/15 text-rose-400 text-xs font-bold flex items-start gap-2">
      <Ban className="w-4 h-4 shrink-0 mt-px" />
      <div>
        Order {norm(orderNo) ? `#${norm(orderNo)} ` : ""}was {word(info).toUpperCase()}{info.reason ? <> — <span dir="auto">{info.reason}</span></> : ""}. Do not call the customer about it — {how}
        <div className="text-[10px] font-normal opacity-80 mt-0.5">From the GrubTech order archive.</div>
      </div>
    </div>
  );
}
