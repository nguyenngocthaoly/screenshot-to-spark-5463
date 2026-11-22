import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setData, setState, useApp } from "@/lib/store";
import { billFigures, findBill, findEntity, findOffset, findPo, findSupplier, fmtMoney, offsetDisplayFigures, soAttribution } from "@/lib/offsetCalc";
import { attachSignedFile, offsetActions, runOffsetAction, setSignedAmount, STATUS_FLOW, type ActionId } from "@/lib/offsetWorkflow";
import { Blocked, Btn, M, Section, StatusBadge } from "@/components/app/bits";
import { OffsetPanel } from "@/components/app/OffsetPanel";
import { formatNumber, formatQty, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Offset } from "@/data/types";

export const Route = createFileRoute("/offsets/$offsetId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.offsetId} · Debt offset` },
      { name: "description", content: `Offset record ${params.offsetId}: amounts, FX, journal, minutes and history.` },
      { property: "og:title", content: `${params.offsetId} · Debt offset` },
      { property: "og:description", content: "Offset record with journal, minutes and approvals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OffsetRecord,
});

function Stepper({ o }: { o: Offset }) {
  const idx = STATUS_FLOW.indexOf(o.status as (typeof STATUS_FLOW)[number]);
  const ended = o.status === "Cancelled" || o.status === "Reversed";
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {STATUS_FLOW.map((s, i) => {
        const reached = o.status === "Reversed" ? true : idx >= i;
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={cn("rounded px-2 py-1", reached ? (s === "Posted" ? "bg-success-soft text-success-text" : i === idx ? "bg-warning-soft text-warning-text font-medium" : "bg-accent text-accent-foreground") : "bg-muted text-muted-foreground")}>{i + 1}. {s}</span>
            {i < STATUS_FLOW.length - 1 && <span className="text-muted-foreground">›</span>}
          </li>
        );
      })}
      {ended && <li className="ml-2"><StatusBadge status={o.status} /></li>}
    </ol>
  );
}

function OffsetRecord() {
  const { offsetId } = Route.useParams();
  const s = useApp();
  const { data, rules } = s;
  const o = findOffset(data, offsetId);
  const [edit, setEdit] = useState(false);
  const [reasonFor, setReasonFor] = useState<ActionId | null>(null);
  const [reason, setReason] = useState("");
  if (!o) return <div className="p-6">Offset {offsetId} not found. <Link to="/" className="text-primary underline">Back</Link></div>;
  const po = findPo(data, o.sourcePoId);
  const bill = findBill(data, o.targetBillId);
  const ent = po ? findEntity(data, po.entityId) : undefined;
  const sup = po ? findSupplier(data, po.supplierId) : undefined;
  const c = po?.currency ?? "";
  const fig = offsetDisplayFigures(data, rules, o);
  const bf = billFigures(data, rules, o.targetBillId);
  const actions = offsetActions(data, rules, s, o);
  const attr = soAttribution(data, rules, o);

  const run = (id: ActionId) => {
    if (id === "edit") return setEdit(true);
    const a = actions.find((x) => x.id === id);
    if (a?.needsReason && reasonFor !== id) { setReasonFor(id); setReason(""); return; }
    const r = runOffsetAction(data, rules, s, o.id, id, { reason });
    if (!r.ok) return void toast.error(r.error);
    setData(r.value); setReasonFor(null); setReason("");
    const result = findOffset(r.value, o.id);
    if (!result) return;
    const resultCurrency = result.frozen?.currency ?? result.minutes?.figures.currency ?? c;
    const resultAmount = fmtMoney(result.frozen?.amount ?? result.amount, resultCurrency, rules);
    switch (id) {
      case "approve-post": {
        const target = billFigures(r.value, rules, result.targetBillId);
        toast.success(`Posted as ${result.journalId}. ${result.targetBillId} now has ${target ? fmtMoney(target.billOpen, target.currency, rules) : "an updated balance"} open.`);
        break;
      }
      case "reverse":
        toast.success(`Reversed with ${result.reversal?.journalId}. ${resultAmount} credit returned to ${result.sourcePoId}.`);
        break;
      case "submit":
        toast.success(`${result.id} sent to Accounting for review.`);
        break;
      case "generate-minutes":
        toast.success(`${result.minutes?.number} generated. Amounts are locked for signature.`);
        break;
      case "approve":
        toast.success(`${result.id}: first approval recorded. A second accountant must approve and post.`);
        break;
      case "return":
        toast.success(`${result.id} returned to Draft. Minutes voided.`);
        break;
      case "cancel":
        toast.success(`${result.id} cancelled. ${resultAmount} credit released on ${result.sourcePoId}.`);
        break;
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" onClick={() => po && setState({ supplierId: po.supplierId })} className="text-xs text-primary hover:underline">← {sup?.name ?? "Supplier"}</Link>
        <h1 className="text-base font-semibold">{o.id}</h1>
        <StatusBadge status={o.status} />
        <span className="text-xs text-muted-foreground">{o.sourcePoId} → {o.targetBillId} · {ent?.name} · created by {o.createdBy} {o.createdAt}</span>
      </div>
      <Stepper o={o} />

      <div className="panel no-print p-3">
        <div className="mb-2 text-xs font-medium">Actions · viewing as {s.role} ({s.userName})</div>
        {actions.length === 0 && <p className="text-xs text-muted-foreground">No actions — this offset is {o.status}. Posted offsets cannot be edited or deleted.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((a) => (
            <div key={a.id}>
              <Btn tone={a.tone} disabled={a.blockers.length > 0} onClick={() => run(a.id)}>{a.label}</Btn>
              <Blocked reasons={a.blockers} />
              {reasonFor === a.id && (
                <div className="mt-1 flex gap-1">
                  <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reason.trim() && run(a.id)} placeholder="Reason (required)" className="h-7 flex-1 rounded-md border bg-card px-2 text-xs" />
                  <Btn tone={a.tone} disabled={!reason.trim()} onClick={() => run(a.id)}>Confirm</Btn>
                </div>
              )}
              {reasonFor === a.id && !reason.trim() && <p className="blocked-text mt-0.5">⛔ A reason is required</p>}
            </div>
          ))}
        </div>
        {o.approvals.length > 0 && <p className="formula mt-2">Approvals: {o.approvals.map((x) => `${x.by} (${x.at})`).join(", ")}</p>}
      </div>

      <Tabs defaultValue="details">
        <TabsList className="h-8"><TabsTrigger value="details" className="text-xs">Details</TabsTrigger><TabsTrigger value="so" className="text-xs">Sales order impact</TabsTrigger><TabsTrigger value="history" className="text-xs">History ({o.history.length})</TabsTrigger></TabsList>
        <TabsContent value="details" className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="panel p-3"><div className="text-xs text-muted-foreground">Offset amount</div><M v={o.amount} c={c} className="text-lg font-semibold" /></div>
            <div className="panel p-3"><div className="text-xs text-muted-foreground">{o.targetBillId} payable now</div>{bf && <M v={bf.payableNow} c={c} className="text-lg font-semibold" />}<div className="formula">open {bf && fmtMoney(bf.billOpen, c, rules)} − held {bf && fmtMoney(bf.held, c, rules)} − in run {bf && fmtMoney(bf.inPaymentRun, c, rules)}</div></div>
            {fig.ok ? <>
              <div className="panel p-3"><div className="text-xs text-muted-foreground">FX {fig.value.fx >= 0 ? "gain" : "loss"}</div><M v={fig.value.fx} c={fig.value.bookCurrency} className={cn("text-lg font-semibold", fig.value.fx >= 0 ? "text-success-text" : "text-destructive-text")} /><div className="formula">bill side − advance side</div></div>
              <div className="panel p-3"><div className="text-xs text-muted-foreground">Numbers</div><div className="text-xs">{o.frozen ? "Frozen at posting" : o.minutes ? `Locked by minutes ${o.minutes.number}` : "Live — recalculated on every edit"}</div><div className="formula">method {fig.value.method}</div></div>
            </> : <div className="panel col-span-2 p-3"><p className="blocked-text">⛔ {fig.error}</p></div>}
          </div>
          {fig.ok && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Section title={`Book-currency breakdown (${fig.value.bookCurrency})`}>
                <table className="dt">
                  <thead><tr><th>Side</th><th>Source</th><th className="num">Amount {c}</th><th className="num">Rate</th><th className="num">Book</th></tr></thead>
                  <tbody>
                    {fig.value.advanceSlices.map((sl) => <tr key={sl.paymentId}><td>Advance</td><td>{sl.paymentId}{sl.date && ` · ${sl.date}`}</td><td className="num">{formatNumber(sl.amount, 2)}</td><td className="num">{formatRate(sl.rate)}</td><td className="num">{formatNumber(sl.book, 0)}</td></tr>)}
                    <tr><td>Bill</td><td>{o.targetBillId} · {fig.value.billDate}</td><td className="num">{formatNumber(fig.value.amount, 2)}</td><td className="num">{formatRate(fig.value.billRate)}</td><td className="num">{formatNumber(fig.value.billSide, 0)}</td></tr>
                  </tbody>
                  <tfoot><tr><td colSpan={4}>Advance side {fmtMoney(fig.value.advanceSide, fig.value.bookCurrency, rules)} · FX</td><td className="num"><M v={fig.value.fx} c={fig.value.bookCurrency} /></td></tr></tfoot>
                </table>
              </Section>
              <Section title={o.frozen ? "NetSuite journal" : "Journal preview"} right={o.journalId && <span className="num text-xs">{o.journalId}</span>}>
                <table className="dt">
                  <thead><tr><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                  <tbody>{fig.value.journal.map((j) => <tr key={j.account}><td>{j.account}</td><td>{j.description}</td><td className="num">{j.debit ? fmtMoney(j.debit, fig.value.bookCurrency, rules) : ""}</td><td className="num">{j.credit ? fmtMoney(j.credit, fig.value.bookCurrency, rules) : ""}</td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={2}>Totals {fig.value.totalDebit === fig.value.totalCredit ? "· balanced" : "· NOT balanced"}</td><td className="num"><M v={fig.value.totalDebit} c={fig.value.bookCurrency} /></td><td className="num"><M v={fig.value.totalCredit} c={fig.value.bookCurrency} /></td></tr></tfoot>
                </table>
              </Section>
            </div>
          )}
          {o.reversal && o.frozen && (
            <Section title="Reversing journal" right={<span className="num text-xs">{o.reversal.journalId ?? "Legacy reversal"}</span>}>
              <table className="dt">
                <thead><tr><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                <tbody>{(o.reversal.journal ?? o.frozen.journal.map((line) => ({ ...line, debit: line.credit, credit: line.debit }))).map((j) => <tr key={j.account}><td>{j.account}</td><td>{j.description}</td><td className="num">{j.debit ? fmtMoney(j.debit, o.frozen?.bookCurrency ?? "", rules) : ""}</td><td className="num">{j.credit ? fmtMoney(j.credit, o.frozen?.bookCurrency ?? "", rules) : ""}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={2}>Totals · balanced</td><td className="num"><M v={o.frozen.totalCredit} c={o.frozen.bookCurrency} /></td><td className="num"><M v={o.frozen.totalDebit} c={o.frozen.bookCurrency} /></td></tr></tfoot>
              </table>
            </Section>
          )}
          <Minutes o={o} />
        </TabsContent>
        <TabsContent value="so" className="space-y-3">
          <Section title="SO attribution (reporting only)" right={<span className="formula">basis {rules.attributionBasis === "SOURCE_PO" ? "source PO" : "both POs"}{attr.ok && ` (${attr.value.basisPoIds.join(" + ")})`} · {attr.ok && attr.value.frozen ? "frozen — all B/L issued" : "live — B/L not issued on all shipments"}</span>}>
            {!attr.ok ? <p className="blocked-text p-3">⛔ {attr.error}</p> : attr.value.rows.length === 0 ? <p className="p-3 text-xs text-muted-foreground">No shipments from the basis PO(s).</p> : (
              <table className="dt">
                <thead><tr><th>SO</th><th>Buyer</th><th>Entity</th><th className="num">Tonnes</th><th className="num">Share</th><th className="num">Attributed credit</th></tr></thead>
                <tbody>{attr.value.rows.map((r) => <tr key={r.soId}><td>{r.soId}</td><td>{r.so?.buyer}</td><td>{r.entityName}{r.otherEntity && <span className="ml-1 text-warning-text">· other entity</span>}</td><td className="num">{formatQty(r.qty)}</td><td className="num">{(r.share * 100).toFixed(2)}%</td><td className="num"><M v={r.amount} c={attr.value.currency} /></td></tr>)}</tbody>
                <tfoot><tr><td colSpan={3}>Total</td><td className="num">{formatQty(attr.value.totalQty)}</td><td /><td className="num"><M v={attr.value.amount} c={attr.value.currency} /></td></tr></tfoot>
              </table>
            )}
            <p className="formula px-3 py-2">credit × tonnes the basis PO(s) shipped to each SO ÷ total tonnes of those PO(s); largest-remainder rounding</p>
          </Section>
          <div className="panel p-3 text-xs">
            <p>This offset changes no SO cost or margin. It cannot be booked on an SO in another entity.</p>
            <Btn className="mt-2" disabled>Assign credit to SO</Btn>
            <p className="blocked-text mt-1">⛔ Attribution is reporting only — offsets settle supplier balances and are never posted to sales orders.</p>
          </div>
        </TabsContent>
        <TabsContent value="history">
          <Section title="History">
            <table className="dt">
              <thead><tr><th>When</th><th>Who</th><th>Role</th><th>Action</th><th>Note</th></tr></thead>
              <tbody>{[...o.history].reverse().map((h, i) => <tr key={i}><td className="num">{h.at}</td><td>{h.by}</td><td>{h.role}</td><td>{h.action}</td><td>{h.note}</td></tr>)}</tbody>
            </table>
          </Section>
        </TabsContent>
      </Tabs>
      {edit && po && bill && <OffsetPanel poId={po.id} offsetId={o.id} open={edit} onClose={() => setEdit(false)} />}
    </div>
  );
}

function Minutes({ o }: { o: Offset }) {
  const s = useApp();
  const { data, rules } = s;
  const m = o.minutes;
  const po = findPo(data, o.sourcePoId);
  const ent = po ? findEntity(data, po.entityId) : undefined;
  const sup = po ? findSupplier(data, po.supplierId) : undefined;
  const c = po?.currency ?? "";
  const editable = s.role === "Purchasing" && o.status === "Awaiting signature";
  const lockedMoney = (value: number) => m?.balances
    ? `${formatNumber(value, m.balances.decimals)} ${m.balances.currency}`
    : fmtMoney(value, m?.figures.currency ?? c, rules);
  return (
    <Section title="Minutes · Biên bản cấn trừ công nợ" right={o.voidedMinutes.length > 0 ? <span className="formula">{o.voidedMinutes.length} voided version(s)</span> : null}>
      {!m ? <p className="p-3 text-xs text-muted-foreground">{o.status === "Draft" ? "Generate minutes to lock the amounts." : "No minutes."}</p> : (
        <div className="grid gap-3 p-3 lg:grid-cols-[1fr_300px]">
          <div className="rounded-md border bg-background p-5 font-serif text-[13px] leading-relaxed">
            <p className="text-center text-xs">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM · Độc lập – Tự do – Hạnh phúc</p>
            <h3 className="mt-3 text-center text-base font-bold">BIÊN BẢN CẤN TRỪ CÔNG NỢ</h3>
            <p className="text-center italic">Debt offset minutes · No. {m.number} · {m.generatedAt.slice(0, 10)}</p>
            <p className="mt-3"><b>Bên A / Party A:</b> {ent?.name} (buyer / bên mua)</p>
            <p><b>Bên B / Party B:</b> {sup?.name} (supplier / nhà cung cấp)</p>
            <p className="mt-2">Hai bên thống nhất cấn trừ số tiền ứng trước của đơn hàng <b>{o.sourcePoId}</b> vào hóa đơn <b>{o.targetBillId}</b> với số tiền:</p>
            <p className="italic">Both parties agree to offset the advance paid on <b>{o.sourcePoId}</b> against bill <b>{o.targetBillId}</b> for the amount of:</p>
            <p className="my-2 text-center text-lg font-bold">{lockedMoney(m.amount)}</p>
            <table aria-label="Locked minutes balances" className="dt my-3 w-full table-fixed [&_th]:whitespace-normal">
              <colgroup><col className="w-2/3" /><col className="w-1/3" /></colgroup>
              <thead><tr><th scope="col">Nội dung / Description</th><th scope="col" className="num">Số tiền / Amount</th></tr></thead>
              <tbody>
                {[
                  { vi: "Tiền ứng trước chưa sử dụng", en: `Unused advance on ${o.sourcePoId}`, value: m.balances?.sourcePoCredit },
                  { vi: "Công nợ hóa đơn trước cấn trừ", en: `Amount open on ${o.targetBillId}`, value: m.balances?.targetBillOpen },
                  { vi: "Số tiền cấn trừ", en: "Amount offset", value: m.balances?.offsetAmount ?? m.amount },
                  { vi: "Công nợ hóa đơn còn phải thanh toán sau cấn trừ", en: "Amount still payable after offset", value: m.balances?.targetBillAfter },
                ].map((row) => <tr key={row.en}><th scope="row" className="font-normal"><span className="block">{row.vi}</span><span className="block font-normal italic">{row.en}</span></th><td className="num align-middle">{row.value === undefined ? "—" : lockedMoney(row.value)}</td></tr>)}
              </tbody>
            </table>
            {!m.balances && <p className="text-xs text-muted-foreground">Biên bản cũ chưa lưu số dư / These older minutes have no saved balance snapshot.</p>}
            <p>Sau cấn trừ, công nợ còn lại của hóa đơn được thanh toán theo điều khoản hợp đồng. / After the offset, the remaining bill balance is paid per contract terms.</p>
            <div className="mt-8 grid grid-cols-2 gap-6 text-center">
              {["A", "B"].map((p) => <div key={p}><b>ĐẠI DIỆN BÊN {p}</b><div className="italic">For Party {p}</div><div className="mt-14 border-t pt-1 text-xs">(Ký, ghi rõ họ tên, đóng dấu / Sign, full name, stamp)</div></div>)}
            </div>
          </div>
          <div className="space-y-3 text-xs">
            <div><div className="font-medium">Signed file</div>
              {o.signedFile ? <div className="mt-1 flex items-center gap-2"><span className="rounded bg-success-soft px-1.5 py-0.5 text-success-text">{o.signedFile.name}</span>{editable && <button className="text-destructive-text underline" onClick={() => { const r = attachSignedFile(data, s, o.id, null); if (r.ok) setData(r.value); }}>remove</button>}</div>
                : <input type="file" disabled={!editable} className="mt-1 text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = attachSignedFile(data, s, o.id, { name: f.name, size: f.size }); r.ok ? setData(r.value) : toast.error(r.error); }} />}
            </div>
            <div><div className="font-medium">Amount on signed minutes ({c})</div>
              <input disabled={!editable} value={o.signedAmountRaw} onChange={(e) => { const r = setSignedAmount(data, s, o.id, e.target.value); if (r.ok) setData(r.value); }} className="num mt-1 h-7 w-full rounded-md border bg-card px-2" placeholder={formatNumber(o.amount, 2)} />
            </div>
            {!editable && o.status === "Awaiting signature" && <p className="blocked-text">⛔ Only Purchasing can attach the signed minutes</p>}
            <p className="formula">Generated by {m.generatedBy} at {m.generatedAt}. Amounts are locked; editing returns the offset to Draft and voids these minutes.</p>
          </div>
        </div>
      )}
    </Section>
  );
}
