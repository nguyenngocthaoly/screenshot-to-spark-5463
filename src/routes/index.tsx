import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { setState, useApp } from "@/lib/store";
import { fmtMoney, supplierSummary, unusedCreditBook } from "@/lib/offsetCalc";
import { offsetCreditBlockers, offsetCreditState } from "@/lib/offsetWorkflow";
import { Blocked, Btn, M, Section, StatusBadge, selectCls } from "@/components/app/bits";
import { OffsetPanel } from "@/components/app/OffsetPanel";
import { formatQty } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Supplier workspace · Debt offset" },
      { name: "description", content: "Supplier POs, bills, credit and debt offsets for the trading back-office." },
      { property: "og:title", content: "Supplier workspace · Debt offset" },
      { property: "og:description", content: "Supplier POs, bills, credit and debt offsets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Workspace,
});

function Card({ title, formula, lines }: { title: string; formula: string; lines: { v: number; c: string; sub?: string }[] }) {
  return (
    <div className="panel p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      {lines.length === 0 && <div className="num mt-1 text-lg">—</div>}
      {lines.map((l, i) => (
        <div key={i} className="mt-1"><M v={l.v} c={l.c} className="text-lg font-semibold" />{l.sub && <div className="formula">{l.sub}</div>}</div>
      ))}
      <div className="formula mt-1.5">{formula}</div>
    </div>
  );
}

function Workspace() {
  const { data, rules, supplierId, role, userName } = useApp();
  const [panel, setPanel] = useState<string | null>(null);
  const sum = supplierSummary(data, rules, supplierId) ?? supplierSummary(data, rules, data.suppliers[0]?.id ?? "");
  if (!sum) return <p className="p-6">No suppliers. Add one in Edit data.</p>;
  const session = { role, userName };
  const poIds = new Set(sum.pos.map((p) => p.po.id));
  const offsets = data.offsets.filter((o) => poIds.has(o.sourcePoId));
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-base font-semibold">Supplier workspace</h1>
        <select className={selectCls} value={sum.supplier.id} onChange={(e) => setState({ supplierId: e.target.value })}>
          {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="formula">Today {data.asOfDate}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Open bills" formula="Σ bill open = amount − settled from advance − paid in cash − posted offsets in" lines={sum.byCurrency.map((x) => ({ v: x.openBills, c: x.currency }))} />
        <Card title="Credit on POs" formula="Σ credit = advance paid − advance used − posted offsets out" lines={sum.byCurrency.map((x) => ({ v: x.credit, c: x.currency }))} />
        <Card title="Net position" formula="Σ bill open − Σ credit (positive = we owe)" lines={sum.byCurrency.map((x) => ({ v: x.net, c: x.currency }))} />
        <Card title="Unused credit in book currency" formula="remaining advance slices at their own rates · same credit at latest rate" lines={sum.byBook.map((b) => ({ v: b.historical, c: b.bookCurrency, sub: b.errors.length ? b.errors.join("; ") : `at latest rate ${fmtMoney(b.atLatest, b.bookCurrency, rules)} (Δ ${fmtMoney(b.difference, b.bookCurrency, rules)})` }))} />
      </div>

      <Section title="Purchase orders">
        <table className="dt">
          <thead><tr><th>PO</th><th>Entity</th><th>Status</th><th className="num">Qty ord / rec</th><th className="num">Advance paid</th><th className="num">Advance used</th><th className="num">Posted out</th><th className="num">Credit</th><th className="num">Reserved</th><th className="num">Available</th><th className="num">Credit in book</th><th></th></tr></thead>
          <tbody>
            {sum.pos.map((p) => {
              const b = offsetCreditBlockers(data, rules, session, p.po.id);
              const u = p.creditOnPO > 0 ? unusedCreditBook(data, rules, p.po.id) : null;
              return (
                <tr key={p.po.id}>
                  <td className="font-medium">{p.po.id}<div className="formula">{p.currency}</div></td>
                  <td>{p.entity?.name}<div className="formula">book {p.bookCurrency}</div></td>
                  <td>{p.po.status}</td>
                  <td className="num">{formatQty(p.po.qtyOrdered)} / {formatQty(p.po.qtyReceived)}</td>
                  <td className="num"><M v={p.advancePaid} c={p.currency} /></td>
                  <td className="num"><M v={p.advanceUsed} c={p.currency} /></td>
                  <td className="num"><M v={p.postedOut} c={p.currency} /></td>
                  <td className="num"><M v={p.creditOnPO} c={p.currency} /></td>
                  <td className="num"><M v={p.reserved} c={p.currency} /></td>
                  <td className="num font-semibold"><M v={p.available} c={p.currency} /></td>
                  <td className="num">{u ? (u.ok ? <M v={u.value.historical} c={u.value.bookCurrency} /> : <span className="blocked-text">{u.error}</span>) : "—"}</td>
                  <td className="w-64">{offsetCreditState(data, rules, session, p.po.id) === "no-credit"
                    ? <span className="text-xs text-muted-foreground">No credit to offset</span>
                    : <><Btn disabled={b.length > 0} onClick={() => setPanel(p.po.id)}>Offset credit</Btn><Blocked reasons={b} /></>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Bills">
        <table className="dt">
          <thead><tr><th>Bill</th><th>PO</th><th>Date</th><th>Due</th><th className="num">Amount</th><th className="num">From advance</th><th className="num">Paid cash</th><th className="num">Offsets in</th><th className="num">Open</th><th className="num">Held</th><th className="num">In payment run</th><th className="num">Payable now</th></tr></thead>
          <tbody>
            {sum.bills.map((b) => (
              <tr key={b.bill.id}>
                <td className="font-medium">{b.bill.id}</td><td>{b.bill.poId}</td><td>{b.bill.date}</td><td>{b.bill.dueDate}</td>
                <td className="num"><M v={b.bill.amount} c={b.currency} /></td>
                <td className="num"><M v={b.bill.settledFromAdvance} c={b.currency} /></td>
                <td className="num"><M v={b.bill.paidInCash} c={b.currency} /></td>
                <td className="num"><M v={b.postedIn} c={b.currency} /></td>
                <td className="num"><M v={b.billOpen} c={b.currency} /></td>
                <td className="num text-warning-text"><M v={b.held} c={b.currency} /></td>
                <td className="num"><M v={b.inPaymentRun} c={b.currency} /></td>
                <td className="num font-semibold"><M v={b.payableNow} c={b.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Offsets">
        {offsets.length === 0 ? <p className="p-3 text-xs text-muted-foreground">No offsets yet for this supplier.</p> : (
          <table className="dt">
            <thead><tr><th>Offset</th><th>Source → target</th><th className="num">Amount</th><th>Status</th><th>Created by</th><th>Created</th></tr></thead>
            <tbody>
              {offsets.map((o) => (
                <tr key={o.id}>
                  <td><Link to="/offsets/$offsetId" params={{ offsetId: o.id }} className="font-medium text-primary hover:underline">{o.id}</Link></td>
                  <td>{o.sourcePoId} → {o.targetBillId}</td>
                  <td className="num"><M v={o.amount} c={sum.pos.find((p) => p.po.id === o.sourcePoId)?.currency ?? ""} /></td>
                  <td><StatusBadge status={o.status} /></td><td>{o.createdBy}</td><td className="num">{o.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {panel && <OffsetPanel poId={panel} open={!!panel} onClose={() => setPanel(null)} />}
    </div>
  );
}
