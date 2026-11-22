import { createFileRoute, Link } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { personaOverviewTab, useApp } from "@/lib/store";
import { findBill, findPo, findSupplier, findEntity, pendingReviewCount, reviewQueue, supplierCreditRanking } from "@/lib/offsetCalc";
import { M, Section, StatusBadge } from "@/components/app/bits";

export const Route = createFileRoute("/overview")({
  head: () => ({
    meta: [
      { title: "Overview · Debt offset" },
      { name: "description", content: "Review queue of debt offsets and supplier credit in book currency." },
      { property: "og:title", content: "Overview · Debt offset" },
      { property: "og:description", content: "Review queue and supplier credit ranking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { data, rules, role, userName } = useApp();
  const [tab, setTab] = useState<string>(personaOverviewTab(role));
  useEffect(() => setTab(personaOverviewTab(role)), [role, userName]);
  const q = reviewQueue(data);
  const ranking = supplierCreditRanking(data, rules);
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-base font-semibold">Overview</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8"><TabsTrigger value="queue" className="text-xs">Review queue ({pendingReviewCount(data)} pending)</TabsTrigger><TabsTrigger value="credit" className="text-xs">Supplier credit</TabsTrigger></TabsList>
        <TabsContent value="queue">
          <Section title="Review queue" right={<span className="formula">Pending review first, then by bill due date</span>}>
            {q.length === 0 ? <p className="p-3 text-xs text-muted-foreground">Nothing in progress.</p> : (
              <table className="dt">
                <thead><tr><th>Offset</th><th>Status</th><th>Supplier</th><th>Entity</th><th>Source → bill</th><th>Bill due</th><th className="num">Amount</th><th>Created by</th></tr></thead>
                <tbody>{q.map((o) => { const po = findPo(data, o.sourcePoId); return (
                  <tr key={o.id}>
                    <td><Link to="/offsets/$offsetId" params={{ offsetId: o.id }} className="font-medium text-primary hover:underline">{o.id}</Link></td>
                    <td><StatusBadge status={o.status} /></td><td>{po && findSupplier(data, po.supplierId)?.name}</td><td>{po && findEntity(data, po.entityId)?.name}</td>
                    <td>{o.sourcePoId} → {o.targetBillId}</td><td className="num">{findBill(data, o.targetBillId)?.dueDate}</td><td className="num"><M v={o.amount} c={po?.currency ?? ""} /></td><td>{o.createdBy}</td>
                  </tr>); })}</tbody>
              </table>
            )}
          </Section>
        </TabsContent>
        <TabsContent value="credit">
          <Section title="Supplier credit by unused credit in book currency" right={<span className="formula">remaining advance slices at own rates · revalued at latest rate</span>}>
            <table className="dt">
              <thead><tr><th>Supplier</th><th>Entity</th><th>Credit (transaction ccy)</th><th className="num">Unused credit (book)</th><th className="num">At latest rate</th><th className="num">Unrealised Δ</th></tr></thead>
              <tbody>{ranking.map((r) => (
                <tr key={r.supplier.id + r.bookCurrency}>
                  <td className="font-medium">{r.supplier.name}</td><td>{r.entities.join(", ")}</td>
                  <td>{r.credits.map((c) => <div key={c.currency}><M v={c.credit} c={c.currency} /></div>)}</td>
                  <td className="num font-semibold"><M v={r.historical} c={r.bookCurrency} />{r.errors.map((e) => <div key={e} className="blocked-text">{e}</div>)}</td>
                  <td className="num"><M v={r.atLatest} c={r.bookCurrency} /></td><td className="num"><M v={r.difference} c={r.bookCurrency} /></td>
                </tr>))}</tbody>
            </table>
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
