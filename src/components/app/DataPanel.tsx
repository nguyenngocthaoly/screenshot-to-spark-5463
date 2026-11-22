import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Dataset } from "@/data/types";
import { PAYMENT_TYPES, PO_STATUSES } from "@/data/types";
import { exportJson, importJson, setRules, setState, updateData, useApp } from "@/lib/store";
import { ruleLabels } from "@/config/rules";
import { Btn, selectCls } from "./bits";
import { X } from "lucide-react";

type ColType = "text" | "number" | "date" | "bool" | string[] | "ref";
type Col = { key: string; label: string; type: ColType; ref?: (d: Dataset) => string[] };
type TableKey = "purchaseOrders" | "payments" | "bills" | "shipments" | "fxRates" | "entities" | "suppliers" | "salesOrders";

const ids = (k: TableKey) => (d: Dataset) => (d[k] as { id?: string }[]).map((r) => r.id ?? "");
const TABLES: { key: TableKey; label: string; cols: Col[]; blank: (d: Dataset) => Record<string, unknown> }[] = [
  { key: "purchaseOrders", label: "POs", cols: [
    { key: "id", label: "ID", type: "text" }, { key: "entityId", label: "Entity", type: "ref", ref: ids("entities") }, { key: "supplierId", label: "Supplier", type: "ref", ref: ids("suppliers") },
    { key: "currency", label: "Ccy", type: "text" }, { key: "qtyOrdered", label: "Qty ord", type: "number" }, { key: "unitPrice", label: "Unit price", type: "number" },
    { key: "qtyReceived", label: "Qty rec", type: "number" }, { key: "status", label: "Status", type: PO_STATUSES }],
    blank: (d) => ({ id: `PO-${d.purchaseOrders.length + 900}`, entityId: d.entities[0]?.id ?? "", supplierId: d.suppliers[0]?.id ?? "", currency: "USD", qtyOrdered: 1, unitPrice: 0, qtyReceived: 0, status: "Open" }) },
  { key: "payments", label: "Payments", cols: [
    { key: "id", label: "ID", type: "text" }, { key: "poId", label: "PO", type: "ref", ref: ids("purchaseOrders") }, { key: "date", label: "Date", type: "date" }, { key: "type", label: "Type", type: PAYMENT_TYPES }, { key: "amount", label: "Amount", type: "number" }],
    blank: (d) => ({ id: `PAY-${d.payments.length + 900}`, poId: d.purchaseOrders[0]?.id ?? "", date: d.asOfDate, type: "Advance", amount: 0 }) },
  { key: "bills", label: "Bills", cols: [
    { key: "id", label: "ID", type: "text" }, { key: "poId", label: "PO", type: "ref", ref: ids("purchaseOrders") }, { key: "date", label: "Date", type: "date" }, { key: "amount", label: "Amount", type: "number" },
    { key: "settledFromAdvance", label: "From adv.", type: "number" }, { key: "paidInCash", label: "Cash", type: "number" }, { key: "dueDate", label: "Due", type: "date" }, { key: "inPaymentRun", label: "In pay run", type: "number" }],
    blank: (d) => ({ id: `BILL-${d.bills.length + 900}`, poId: d.purchaseOrders[0]?.id ?? "", date: d.asOfDate, amount: 0, settledFromAdvance: 0, paidInCash: 0, dueDate: d.asOfDate, inPaymentRun: 0 }) },
  { key: "shipments", label: "Shipments", cols: [
    { key: "poId", label: "PO", type: "ref", ref: ids("purchaseOrders") }, { key: "soId", label: "SO", type: "ref", ref: ids("salesOrders") }, { key: "qty", label: "Qty (t)", type: "number" }, { key: "blIssued", label: "B/L issued", type: "bool" }],
    blank: (d) => ({ id: `SHP-${Date.now()}`, poId: d.purchaseOrders[0]?.id ?? "", soId: d.salesOrders[0]?.id ?? "", qty: 0, blIssued: false }) },
  { key: "fxRates", label: "FX rates", cols: [
    { key: "currency", label: "Ccy", type: "text" }, { key: "bookCurrency", label: "Book", type: "text" }, { key: "date", label: "Date", type: "date" }, { key: "rate", label: "Rate", type: "number" }],
    blank: (d) => ({ currency: "USD", bookCurrency: "VND", date: d.asOfDate, rate: 0 }) },
  { key: "salesOrders", label: "SOs", cols: [
    { key: "id", label: "ID", type: "text" }, { key: "entityId", label: "Entity", type: "ref", ref: ids("entities") }, { key: "buyer", label: "Buyer", type: "text" }, { key: "currency", label: "Ccy", type: "text" }, { key: "qty", label: "Qty", type: "number" }, { key: "unitPrice", label: "Price", type: "number" }],
    blank: (d) => ({ id: `SO-${d.salesOrders.length + 900}`, entityId: d.entities[0]?.id ?? "", buyer: "", currency: "USD", qty: 0, unitPrice: 0 }) },
  { key: "suppliers", label: "Suppliers", cols: [{ key: "id", label: "ID", type: "text" }, { key: "name", label: "Name", type: "text" }],
    blank: (d) => ({ id: `SUP-${d.suppliers.length + 1}`, name: "New supplier" }) },
  { key: "entities", label: "Entities", cols: [{ key: "id", label: "ID", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "bookCurrency", label: "Book ccy", type: "text" }],
    blank: (d) => ({ id: `ENT-${d.entities.length + 1}`, name: "New entity", bookCurrency: "USD" }) },
];

function NumCell({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [s, setS] = useState(String(value));
  useEffect(() => setS(String(value)), [value]);
  return <input className="cell-input num text-right" value={s} onChange={(e) => { setS(e.target.value); const n = Number(e.target.value.replace(/,/g, "")); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n); }} />;
}

function Table({ t }: { t: (typeof TABLES)[number] }) {
  const { data } = useApp();
  const rows = data[t.key] as unknown as Record<string, unknown>[];
  const set = (i: number, k: string, v: unknown) =>
    updateData((d) => ({ ...d, [t.key]: (d[t.key] as unknown as Record<string, unknown>[]).map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  return (
    <div>
      <table className="dt">
        <thead><tr>{t.cols.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {t.cols.map((c) => {
                const v = r[c.key];
                return (
                  <td key={c.key} className="p-0.5">
                    {c.type === "number" ? <NumCell value={Number(v)} onChange={(n) => set(i, c.key, n)} />
                      : c.type === "bool" ? <input type="checkbox" checked={!!v} onChange={(e) => set(i, c.key, e.target.checked)} className="ml-2 accent-[var(--primary)]" />
                      : Array.isArray(c.type) || c.type === "ref" ? (
                        <select className="cell-input" value={String(v)} onChange={(e) => set(i, c.key, e.target.value)}>
                          {(Array.isArray(c.type) ? c.type : c.ref?.(data) ?? []).map((o) => <option key={o}>{o}</option>)}
                        </select>)
                      : <input className="cell-input" type={c.type === "date" ? "date" : "text"} value={String(v ?? "")} onChange={(e) => set(i, c.key, e.target.value)} />}
                  </td>
                );
              })}
              <td className="p-0.5"><button aria-label="Delete row" className="rounded p-1 text-muted-foreground hover:bg-destructive-soft hover:text-destructive-text" onClick={() => updateData((d) => ({ ...d, [t.key]: (d[t.key] as unknown[]).filter((_, j) => j !== i) }))}><X className="size-3.5" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Btn tone="secondary" className="m-2" onClick={() => updateData((d) => ({ ...d, [t.key]: [...(d[t.key] as unknown[]), t.blank(d)] }))}>+ Add row</Btn>
    </div>
  );
}

function RulesForm() {
  const { rules, data } = useApp();
  const [month, setMonth] = useState(data.asOfDate.slice(0, 7));
  const row = (k: keyof typeof ruleLabels, input: React.ReactNode) => (
    <div className="border-b px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{ruleLabels[k].label}</span>{input}</div><div className="formula mt-0.5">{ruleLabels[k].help}</div></div>
  );
  return (
    <div>
      {row("advanceRateMethod", <select className={selectCls} value={rules.advanceRateMethod} onChange={(e) => setRules({ ...rules, advanceRateMethod: e.target.value as typeof rules.advanceRateMethod })}><option value="FIFO">FIFO</option><option value="WEIGHTED_AVERAGE">Weighted average</option></select>)}
      {row("requireSourcePoClosed", <input type="checkbox" checked={rules.requireSourcePoClosed} onChange={(e) => setRules({ ...rules, requireSourcePoClosed: e.target.checked })} className="accent-[var(--primary)]" />)}
      {row("attributionBasis", <select className={selectCls} value={rules.attributionBasis} onChange={(e) => setRules({ ...rules, attributionBasis: e.target.value as typeof rules.attributionBasis })}><option value="SOURCE_PO">Source PO</option><option value="BOTH_POS">Both POs</option></select>)}
      {row("allowSelfApproval", <input type="checkbox" checked={rules.allowSelfApproval} onChange={(e) => setRules({ ...rules, allowSelfApproval: e.target.checked })} className="accent-[var(--primary)]" />)}
      {row("secondApproverAbove", <input className={`${selectCls} num w-28 text-right`} placeholder="none" defaultValue={rules.secondApproverAbove ?? ""} onBlur={(e) => { const n = Number(e.target.value.replace(/,/g, "")); setRules({ ...rules, secondApproverAbove: e.target.value.trim() === "" || !Number.isFinite(n) ? null : n }); }} />)}
      {row("closedPeriods", <div className="flex gap-1"><input type="month" className={selectCls} value={month} onChange={(e) => setMonth(e.target.value)} /><Btn tone="secondary" onClick={() => month && !rules.closedPeriods.includes(month) && setRules({ ...rules, closedPeriods: [...rules.closedPeriods, month].sort() })}>Close</Btn></div>)}
      <div className="flex flex-wrap gap-1 px-3 py-2">{rules.closedPeriods.length === 0 ? <span className="formula">No closed periods</span> : rules.closedPeriods.map((p) => <button key={p} className="rounded bg-destructive-soft px-1.5 py-0.5 text-[11px] text-destructive-text" onClick={() => setRules({ ...rules, closedPeriods: rules.closedPeriods.filter((x) => x !== p) })}>{p} ×</button>)}</div>
      <div className="border-t px-3 py-2"><div className="flex items-center justify-between"><span className="text-xs font-medium">Demo date (today)</span><input type="date" className={selectCls} value={data.asOfDate} onChange={(e) => e.target.value && updateData((d) => ({ ...d, asOfDate: e.target.value }))} /></div></div>
    </div>
  );
}

function JsonTab() {
  const s = useApp();
  const [text, setText] = useState("");
  return (
    <div className="space-y-2 p-3">
      <Btn onClick={() => { const blob = new Blob([exportJson(s)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "debt-offset-dataset.json"; a.click(); }}>Export dataset JSON</Btn>
      <div className="text-xs font-medium">Import</div>
      <input type="file" accept="application/json" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const err = importJson(await f.text()); err ? toast.error(err) : toast.success("Dataset imported"); }} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste JSON here" className="h-40 w-full rounded-md border bg-card p-2 font-mono text-[11px]" />
      <Btn tone="secondary" disabled={!text.trim()} onClick={() => { const err = importJson(text); err ? toast.error(err) : (toast.success("Dataset imported"), setText("")); }}>Import pasted JSON</Btn>
    </div>
  );
}

export function DataPanel() {
  const [tab, setTab] = useState<string>("rules");
  const t = TABLES.find((x) => x.key === tab);
  return (
    <aside className="no-print flex w-full flex-col border-l bg-card lg:w-[600px] lg:shrink-0">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="section-title">Edit data and rules</h2>
        <button aria-label="Collapse panel" onClick={() => setState({ dataPanelOpen: false })} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button>
      </div>
      <div className="flex flex-wrap gap-1 border-b p-2">
        {[{ key: "rules", label: "Rules" }, ...TABLES, { key: "json", label: "Import / export" }].map((x) => (
          <button key={x.key} onClick={() => setTab(x.key)} className={`rounded px-2 py-1 text-xs ${tab === x.key ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{x.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">{tab === "rules" ? <RulesForm /> : tab === "json" ? <JsonTab /> : t ? <Table key={t.key} t={t} /> : null}</div>
    </aside>
  );
}
