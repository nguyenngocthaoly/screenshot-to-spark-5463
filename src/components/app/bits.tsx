import { cn } from "@/lib/utils";
import type { OffsetStatus } from "@/data/types";
import { useApp } from "@/lib/store";
import { fmtMoney } from "@/lib/offsetCalc";
import type { ReactNode } from "react";

const statusTone: Record<OffsetStatus, string> = {
  Draft: "bg-secondary text-secondary-foreground",
  "Awaiting signature": "bg-warning-soft text-warning-text",
  "Pending review": "bg-warning-soft text-warning-text",
  Posted: "bg-success-soft text-success-text",
  Cancelled: "bg-muted text-muted-foreground line-through",
  Reversed: "bg-destructive-soft text-destructive-text",
};

export function StatusBadge({ status }: { status: OffsetStatus }) {
  return <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", statusTone[status])}>{status}</span>;
}

export function M({ v, c, className }: { v: number; c: string; className?: string }) {
  const { rules } = useApp();
  return <span className={cn("num", className)}>{fmtMoney(v, c, rules)}</span>;
}

export function Blocked({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {reasons.slice(0, 1).map((r) => (
        <li key={r} className="blocked-text">⛔ {r}</li>
      ))}
    </ul>
  );
}

export function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("panel", className)}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="section-title">{title}</h2>
        {right}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

export function Btn({ tone = "primary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "danger" | "ghost" }) {
  const t = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "border bg-card hover:bg-accent",
    danger: "border border-destructive/40 text-destructive-text hover:bg-destructive-soft",
    ghost: "hover:bg-accent",
  }[tone];
  return <button {...p} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45", t, className)} />;
}

export const selectCls = "h-7 rounded-md border bg-card px-2 text-xs";
