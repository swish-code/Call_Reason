import { PhoneOff } from "lucide-react";

// The label shown beside a number on the Do Not Call list. One piece of text that never wraps, so it stays a
// single tidy pill even in a narrow table column. `block` puts it on its own line under the number.
export default function DncBadge({ block = false }: { block?: boolean }) {
  return (
    <span
      title="This customer asked not to be called again"
      className={`${block ? "flex w-fit mt-1" : "inline-flex ml-2 align-middle"} items-center gap-1 whitespace-nowrap px-1.5 py-0.5 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-500 font-sans text-[9px] font-extrabold uppercase tracking-wide leading-none`}
    >
      <PhoneOff className="w-2.5 h-2.5 shrink-0" /> Do not call
    </span>
  );
}
