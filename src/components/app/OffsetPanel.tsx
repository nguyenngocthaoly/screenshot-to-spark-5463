import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { setData, useApp } from "@/lib/store";
import { computeOffsetFigures, findOffset, fmtMoney, offsetLimits, poFigures, roundMoney, validateOffsetAmount } from "@/lib/offsetCalc";
import { createOffsetDraft, updateOffsetDraft, targetBillChoices } from "@/lib/offsetWorkflow";
import { Btn, M } from "./bits";
import { formatNumber } from "@/lib/format";

export function OffsetPanel({ poId, offsetId, open, onClose }: { poId: string; offsetId?: string | undefined; open: boolean; onClose: () => void }) {
  const s = useApp();
  const { data, rules } = s;
  const nav = useNavigate();
  const existing = offsetId ? findOffset(data, offsetId) : undefined;
  const { bills, hiddenCount: hiddenBills } = useMemo(() => targetBillChoices(data, rules, poId, offsetId), [data, rules, poId, offsetId]);
  const firstEligible = existing?.targetBillId ?? bills.find((b) => b.eligible)?.bill.id ?? "";
  const [billId, setBillId] = useState(firstEligible);
  const [raw, setRaw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const po = poFigures(data, rules, poId, { excludeOffsetId: offsetId });
  const lim = billId ? offsetLimits(data, rules, poId, billId, offsetId) : null;

  const prefill = (id: string, useMaximum = false) => {
    const l = offsetLimits(data, rules, poId, id, offsetId);
    const max = !useMaximum && existing && id === existing.targetBillId ? existing.amount : l.ok ? l.value.maxOffset : 0;
    setRaw(formatNumber(max, rules.zeroDecimalCurrencies.includes(po?.currency ?? "") ? 0 : 2));
    setTimeout(() => inputRef.current?.select(), 30);
  };
  useEffect(() => {
    if (open) { setBillId(firstEligible); prefill(firstEligible); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poId, offsetId]);

  if (!po) return null;
  const c = po.currency;
  const valid = lim?.ok ? validateOffsetAmount(raw, lim.value, rules) : null;
  const amt = valid?.ok ? valid.value : 0;
  const fig = valid?.ok ? computeOffsetFigures(data, rules, { sourcePoId: poId, targetBillId: billId, amount: amt, offset: existing }) : null;
  const validationError = valid && !valid.ok ? valid.error : lim && !lim.ok ? lim.error : fig && !fig.ok ? fig.error : null;
  const canSave = !!valid?.ok && !!fig?.ok && s.role === "Purchasing";

  const save = () => {
    if (!canSave) return;
    if (existing) {
      const r = updateOffsetDraft(data, rules, s, existing.id, { sourcePoId: poId, targetBillId: billId, amountRaw: raw });
      if (!r.ok) return void toast.error(r.error);
      setData(r.value); toast.success(`${existing.id} saved`); onClose();
    } else {
      const r = createOffsetDraft(data, rules, s, { sourcePoId: poId, targetBillId: billId, amountRaw: raw });
      if (!r.ok) return void toast.error(r.error);
      setData(r.value.data); toast.success(`Draft ${r.value.offsetId} saved`); onClose();
      nav({ to: "/offsets/$offsetId", params: { offsetId: r.value.offsetId } });
    }
  };

  const L = lim?.ok ? lim.value : null;
  const after = L ? roundMoney(L.bill.billOpen - L.bill.held - amt, c, rules) : 0;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-base">{existing ? `Edit ${existing.id}` : "Offset credit"} · {poId}</SheetTitle>
          <SheetDescription className="text-xs">
            Available on {poId}: <M v={po.available} c={c} /> <span className="formula">= credit {fmtMoney(po.creditOnPO, c, rules)} − reserved {fmtMoney(po.reserved, c, rules)}</span>
          </SheetDescription>
        </SheetHeader>
        {existing?.status === "Awaiting signature" && <p className="mt-2 rounded bg-warning-soft p-2 text-xs text-warning-text">Saving returns this offset to Draft and voids the generated minutes.</p>}
        <h3 className="section-title mt-4 mb-1">Target bill</h3>
        <div className="panel divide-y">
          {bills.map((b) => (
            <label key={b.bill.id} className={cn("flex items-start gap-2 px-2 py-1.5 text-xs", b.eligible ? "cursor-pointer" : "opacity-50")}>
              <input type="radio" disabled={!b.eligible} checked={billId === b.bill.id} onChange={() => { setBillId(b.bill.id); prefill(b.bill.id); }} className="mt-0.5 accent-[var(--primary)]" />
              <div className="flex-1">
                <div className="flex justify-between"><span className="font-medium">{b.bill.id} <span className="text-muted-foreground">· {b.bill.poId} · due {b.bill.dueDate}</span></span><M v={b.figures.payableNow} c={b.figures.currency} /></div>
                {b.reason && <div className="text-muted-foreground">{b.reason}</div>}
              </div>
            </label>
          ))}
        </div>
        {hiddenBills > 0 && <p className="mt-2 text-xs text-muted-foreground">{hiddenBills} bills from other suppliers are not shown.</p>}
        <h3 className="section-title mt-4 mb-1">Amount ({c})</h3>
        <div className="flex items-center gap-2">
        <input aria-label="Offset amount" ref={inputRef} autoFocus value={raw} onFocus={(e) => e.target.select()} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()}
          className={cn("num h-9 w-full rounded-md border bg-card px-2 text-base", valid && !valid.ok && "border-destructive")} placeholder="e.g. 4800, 4,800 or 4.8k" />
          <Btn tone="secondary" className="shrink-0" disabled={!lim?.ok || lim.value.maxOffset <= 0} onClick={() => prefill(billId, true)}>Use maximum</Btn>
        </div>
        {validationError && <p className="blocked-text mt-1">{validationError}</p>}
        {L && (
          <div className="panel mt-4 p-3 text-xs">
            <h3 className="section-title mb-2">Live preview</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5">
              <dt>Max offset <div className="formula">cap set by {L.cap === "source" ? "source PO" : "target bill"}: {L.capText}</div></dt><dd><M v={L.maxOffset} c={c} /></dd>
              <dt>Bill open after offset <div className="formula">open {fmtMoney(L.bill.billOpen, c, rules)} − held {fmtMoney(L.bill.held, c, rules)} − this offset</div></dt><dd><M v={after} c={c} /></dd>
              <dt>Cash still to pay <div className="formula">open after − in payment run {fmtMoney(L.bill.inPaymentRun, c, rules)}</div></dt><dd><M v={roundMoney(after - L.bill.inPaymentRun, c, rules)} c={c} /></dd>
              {fig?.ok && <>
                <dt>Advance side <div className="formula">{fig.value.method === "FIFO" ? fig.value.advanceSlices.map((x) => `${x.paymentId} ${formatNumber(x.amount, 2)}×${x.rate}`).join(" + ") : `avg rate ${fig.value.avgRate?.toFixed(4)}`}</div></dt><dd><M v={fig.value.advanceSide} c={fig.value.bookCurrency} /></dd>
                <dt>Bill side <div className="formula">amount × {fig.value.billRate} ({fig.value.billDate})</div></dt><dd><M v={fig.value.billSide} c={fig.value.bookCurrency} /></dd>
                <dt>FX {fig.value.fx >= 0 ? "gain" : "loss"} <div className="formula">bill side − advance side</div></dt><dd><M v={fig.value.fx} c={fig.value.bookCurrency} className={fig.value.fx >= 0 ? "text-success-text" : "text-destructive-text"} /></dd>
              </>}
            </dl>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <Btn onClick={save} disabled={!canSave}>{existing ? "Save changes" : "Save draft"}</Btn>
          <Btn tone="secondary" onClick={onClose}>Close</Btn>
          <span className="formula">Enter saves · Esc closes</span>
        </div>
        {s.role !== "Purchasing" && <p className="blocked-text mt-1">⛔ Only Purchasing can save offsets (viewing as {s.role})</p>}
      </SheetContent>
    </Sheet>
  );
}
