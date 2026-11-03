import type { ClipboardEvent } from "react";

// Double-click / select-all on a number makes the browser take the space (or line break) after it too, and that lands in
// the dialler or the search box next to the number. Copying from a phone element always puts just the digits on the clipboard.
export function phoneOnCopy(e: ClipboardEvent<HTMLElement>) {
  const sel = window.getSelection()?.toString() ?? "";
  const clean = sel.trim();
  if (!clean || !/^[\d\s+()-]+$/.test(clean)) return;
  e.clipboardData.setData("text/plain", clean.replace(/\s+/g, ""));
  e.preventDefault();
}
