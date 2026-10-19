import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.ts";

// Do Not Call: customers who asked us not to contact them again. Numbers are matched on their LAST 8 DIGITS,
// the same way the server does, so +965 / 965 / local forms of one number all match.
export const dncKey = (phone?: string | null): string => {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : "";
};

export function useDoNotCall() {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const reload = useCallback(async () => {
    try {
      const res = await apiFetch("/api/do-not-call/keys");
      if (res.ok) setKeys(new Set(((await res.json()).keys as string[]) || []));
    } catch { /* a missing list just means nothing is flagged */ }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const isDnc = useCallback((phone?: string | null) => { const k = dncKey(phone); return !!k && keys.has(k); }, [keys]);

  /** Add a number to the list. Returns an error message, or "" on success. */
  const add = useCallback(async (phone: string, reason: string, source: string, assignmentId?: string): Promise<string> => {
    try {
      const res = await apiFetch("/api/do-not-call", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, reason, source, assignment_id: assignmentId }),
      });
      if (!res.ok) return (await res.json().catch(() => ({}))).error || "Could not add the number.";
      await reload();
      return "";
    } catch (e: any) { return e.message || "Could not add the number."; }
  }, [reload]);

  return { isDnc, add, reload };
}

/** The red label shown beside a number that must not be called. */
export const DNC_TEXT = "DO NOT CALL";
