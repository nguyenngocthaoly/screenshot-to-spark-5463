/**
 * offsetCalc — the only place business numbers are computed.
 * Every function is pure over (data, rules) and works for any number of
 * suppliers, entities, POs, payments, bills, shipments, currencies and rates.
 */
import type { Rules } from "@/config/rules";
import type {
  AdvanceRateMethod,
  AdvanceSlice,
  AttributionBasis,
  AttributionBasisRow,
  Bill,
  Currency,
  Dataset,
  Entity,
  JournalLine,
  Offset,
  OffsetFigures,
  OffsetStatus,
  Payment,
  PurchaseOrder,
  SalesOrder,
  Supplier,
} from "@/data/types";
import { formatNumber } from "./format";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(error: string): Result<T> => ({ ok: false, error });

export const ACTIVE_STATUSES: OffsetStatus[] = ["Draft", "Awaiting signature", "Pending review"];
export const isActiveStatus = (s: OffsetStatus) => ACTIVE_STATUSES.includes(s);

/* ------------------------------------------------------------------ money */

export function currencyDecimals(currency: Currency, rules: Rules): number {
  return rules.zeroDecimalCurrencies.includes(currency) ? 0 : 2;
}

/** Round half-up (away from zero on .5), robust to binary float noise. */
export function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** decimals;
  const scaled = Number((Math.abs(value) * f).toPrecision(15));
  const r = Math.floor(scaled + 0.5) / f;
  if (r === 0) return 0;
  return value < 0 ? -r : r;
}

export function roundMoney(value: number, currency: Currency, rules: Rules): number {
  return roundHalfUp(value, currencyDecimals(currency, rules));
}

export function fmtMoney(value: number, currency: Currency, rules: Rules): string {
  return `${formatNumber(value, currencyDecimals(currency, rules))} ${currency}`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/* ---------------------------------------------------------------- lookups */

export const findPo = (data: Dataset, id: string) => data.purchaseOrders.find((p) => p.id === id);
export const findBill = (data: Dataset, id: string) => data.bills.find((b) => b.id === id);
export const findEntity = (data: Dataset, id: string) => data.entities.find((e) => e.id === id);
export const findSupplier = (data: Dataset, id: string) => data.suppliers.find((s) => s.id === id);
export const findSo = (data: Dataset, id: string) => data.salesOrders.find((s) => s.id === id);
export const findOffset = (data: Dataset, id: string) => data.offsets.find((o) => o.id === id);

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/* ------------------------------------------------------------------ rates */

export function getRate(
  data: Dataset,
  currency: Currency,
  bookCurrency: Currency,
  date: string,
): Result<number> {
  if (currency === bookCurrency) return ok(1);
  const r = data.fxRates.find(
    (x) => x.currency === currency && x.bookCurrency === bookCurrency && x.date === date,
  );
  if (!r || !(r.rate > 0)) return fail(`Missing rate for ${currency} on ${date}`);
  return ok(r.rate);
}

export function latestRate(
  data: Dataset,
  currency: Currency,
  bookCurrency: Currency,
  asOf: string,
): Result<{ rate: number; date: string }> {
  if (currency === bookCurrency) return ok({ rate: 1, date: asOf });
  const candidates = data.fxRates
    .filter(
      (x) => x.currency === currency && x.bookCurrency === bookCurrency && x.date <= asOf && x.rate > 0,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const top = candidates[0];
  if (!top) return fail(`Missing rate for ${currency} on ${asOf}`);
  return ok({ rate: top.rate, date: top.date });
}

/* ------------------------------------------------------------------ per PO */

export interface PoFigures {
  po: PurchaseOrder;
  entity: Entity | undefined;
  supplier: Supplier | undefined;
  currency: Currency;
  bookCurrency: Currency;
  orderValue: number;
  advancePaid: number;
  advanceUsed: number;
  postedOut: number;
  creditOnPO: number;
  reserved: number;
  reservedBy: Offset[];
  available: number;
}

export function poFigures(
  data: Dataset,
  rules: Rules,
  poId: string,
  opts: { excludeOffsetId?: string | undefined } = {},
): PoFigures | null {
  const po = findPo(data, poId);
  if (!po) return null;
  const entity = findEntity(data, po.entityId);
  const c = po.currency;
  const r = (v: number) => roundMoney(v, c, rules);
  const advancePaid = r(sum(data.payments.filter((p) => p.poId === po.id && p.type === "Advance").map((p) => p.amount)));
  const advanceUsed = r(sum(data.bills.filter((b) => b.poId === po.id).map((b) => b.settledFromAdvance)));
  const out = data.offsets.filter((o) => o.sourcePoId === po.id);
  const postedOut = r(sum(out.filter((o) => o.status === "Posted").map((o) => o.amount)));
  const reservedBy = out.filter((o) => isActiveStatus(o.status) && o.id !== opts.excludeOffsetId);
  const reserved = r(sum(reservedBy.map((o) => o.amount)));
  const creditOnPO = r(advancePaid - advanceUsed - postedOut);
  return {
    po,
    entity,
    supplier: findSupplier(data, po.supplierId),
    currency: c,
    bookCurrency: entity?.bookCurrency ?? c,
    orderValue: r(po.qtyOrdered * po.unitPrice),
    advancePaid,
    advanceUsed,
    postedOut,
    creditOnPO,
    reserved,
    reservedBy,
    available: r(creditOnPO - reserved),
  };
}

/* ---------------------------------------------------------------- per bill */

export interface BillFigures {
  bill: Bill;
  po: PurchaseOrder | undefined;
  currency: Currency;
  postedIn: number;
  billOpen: number;
  held: number;
  heldBy: Offset[];
  inPaymentRun: number;
  payableNow: number;
}

export function billFigures(
  data: Dataset,
  rules: Rules,
  billId: string,
  opts: { excludeOffsetId?: string | undefined } = {},
): BillFigures | null {
  const bill = findBill(data, billId);
  if (!bill) return null;
  const po = findPo(data, bill.poId);
  const c = po?.currency ?? "";
  const r = (v: number) => roundMoney(v, c, rules);
  const inn = data.offsets.filter((o) => o.targetBillId === bill.id);
  const postedIn = r(sum(inn.filter((o) => o.status === "Posted").map((o) => o.amount)));
  const heldBy = inn.filter((o) => isActiveStatus(o.status) && o.id !== opts.excludeOffsetId);
  const held = r(sum(heldBy.map((o) => o.amount)));
  const billOpen = r(bill.amount - bill.settledFromAdvance - bill.paidInCash - postedIn);
  const inPaymentRun = r(bill.inPaymentRun);
  return {
    bill,
    po,
    currency: c,
    postedIn,
    billOpen,
    held,
    heldBy,
    inPaymentRun,
    payableNow: r(billOpen - held - inPaymentRun),
  };
}

/* ------------------------------------------------------------- offset max */

export interface OffsetLimits {
  po: PoFigures;
  bill: BillFigures;
  available: number;
  billCapacity: number;
  maxOffset: number;
  cap: "source" | "bill";
  capText: string;
}

export function offsetLimits(
  data: Dataset,
  rules: Rules,
  sourcePoId: string,
  targetBillId: string,
  excludeOffsetId?: string | undefined,
): Result<OffsetLimits> {
  const po = poFigures(data, rules, sourcePoId, { excludeOffsetId });
  if (!po) return fail(`Source PO ${sourcePoId} not found`);
  const bill = billFigures(data, rules, targetBillId, { excludeOffsetId });
  if (!bill) return fail(`Target bill ${targetBillId} not found`);
  const c = po.currency;
  const m = (v: number) => formatNumber(v, currencyDecimals(c, rules));
  const billCapacity = roundMoney(bill.billOpen - bill.held - bill.inPaymentRun, c, rules);
  const cap = po.available <= billCapacity ? "source" : "bill";
  const maxOffset = Math.max(0, Math.min(po.available, billCapacity));
  const capText =
    cap === "source"
      ? po.reserved > 0
        ? `${po.po.id} has ${m(po.creditOnPO)} credit, ${m(po.reserved)} reserved by ${po.reservedBy.map((o) => o.id).join(", ")}`
        : `${po.po.id} available credit is ${m(po.creditOnPO)}`
      : `${bill.bill.id} has ${m(bill.billOpen)} open${bill.held > 0 ? `, ${m(bill.held)} held by ${bill.heldBy.map((o) => o.id).join(", ")}` : ""}${bill.inPaymentRun > 0 ? `, ${m(bill.inPaymentRun)} already in a payment run` : ""}`;
  return ok({ po, bill, available: po.available, billCapacity, maxOffset, cap, capText });
}

/* -------------------------------------------------------- amount parsing */

/** Accepts "4800", "4,800", "4.8k", "1.2m". */
export function parseAmountInput(raw: string): Result<{ value: number; decimals: number; suffix: boolean }> {
  const s = raw.trim().replace(/\s+/g, "");
  if (s === "") return fail("Enter an amount");
  const m = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?([kKmM])?$/.exec(s);
  if (!m || (m[2] === undefined && m[3] === undefined)) return fail(`"${raw.trim()}" is not a number`);
  const sign = m[1] ? -1 : 1;
  const intPart = (m[2] ?? "0").replace(/,/g, "");
  const frac = m[3] ?? "";
  const suffix = m[4]?.toLowerCase();
  const mult = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  const base = Number(`${intPart}${frac ? `.${frac}` : ""}`);
  const value = Number((sign * base * mult).toPrecision(15));
  let decimals = frac.length;
  if (suffix) {
    const str = String(Math.abs(value));
    decimals = str.includes(".") ? (str.split(".")[1] ?? "").length : 0;
  }
  return ok({ value, decimals, suffix: !!suffix });
}

export function validateOffsetAmount(
  raw: string,
  limits: OffsetLimits,
  rules: Rules,
): Result<number> {
  const parsed = parseAmountInput(raw);
  if (!parsed.ok) return parsed;
  const c = limits.po.currency;
  const d = currencyDecimals(c, rules);
  const { value, decimals } = parsed.value;
  if (decimals > d) {
    return fail(d === 0 ? `${c} amounts cannot have decimals` : `More than ${d} decimals`);
  }
  if (value <= 0) return fail("Amount must be greater than 0");
  if (value > limits.maxOffset) {
    const m = (v: number) => fmtMoney(v, c, rules);
    return fail(`Max is ${m(limits.maxOffset)}: ${limits.capText}.`);
  }
  return ok(roundHalfUp(value, d));
}

/* ----------------------------------------------------------- advance side */

export function advancePayments(data: Dataset, poId: string): Payment[] {
  return data.payments
    .filter((p) => p.poId === poId && p.type === "Advance")
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
}

/**
 * Advance amount already consumed on a PO before a given offset:
 * bills settled from advance + other Posted/active offsets created earlier.
 */
export function advanceConsumedBefore(
  data: Dataset,
  rules: Rules,
  poId: string,
  offset?: Pick<Offset, "id" | "createdAt"> | undefined,
): number {
  const po = poFigures(data, rules, poId);
  if (!po) return 0;
  const before = data.offsets.filter((o) => {
    if (o.sourcePoId !== poId || o.id === offset?.id) return false;
    if (o.status !== "Posted" && !isActiveStatus(o.status)) return false;
    if (!offset) return true;
    return o.createdAt === offset.createdAt ? o.id < offset.id : o.createdAt < offset.createdAt;
  });
  return roundMoney(po.advanceUsed + sum(before.map((o) => o.amount)), po.currency, rules);
}

export interface AdvanceSide {
  method: AdvanceRateMethod;
  slices: AdvanceSlice[];
  total: number;
  avgRate: number | null;
}

export function advanceSide(
  data: Dataset,
  rules: Rules,
  po: PurchaseOrder,
  bookCurrency: Currency,
  amount: number,
  consumedBefore: number,
): Result<AdvanceSide> {
  const c = po.currency;
  const payments = advancePayments(data, po.id);
  if (amount <= 0) return ok({ method: rules.advanceRateMethod, slices: [], total: 0, avgRate: null });
  if (payments.length === 0) return fail(`${po.id} has no advance payments`);

  if (rules.advanceRateMethod === "WEIGHTED_AVERAGE") {
    let weighted = 0;
    let total = 0;
    for (const p of payments) {
      const rate = getRate(data, c, bookCurrency, p.date);
      if (!rate.ok) return rate;
      weighted += p.amount * rate.value;
      total += p.amount;
    }
    if (total <= 0) return fail(`${po.id} has no advance amount`);
    const avg = weighted / total;
    const book = roundMoney(amount * avg, bookCurrency, rules);
    return ok({
      method: "WEIGHTED_AVERAGE",
      slices: [{ paymentId: `Average of ${payments.length} advances`, date: "", amount, rate: avg, book }],
      total: book,
      avgRate: avg,
    });
  }

  const slices: AdvanceSlice[] = [];
  let skip = consumedBefore;
  let remaining = roundMoney(amount, c, rules);
  for (const p of payments) {
    if (remaining <= 0) break;
    if (skip >= p.amount) {
      skip = roundMoney(skip - p.amount, c, rules);
      continue;
    }
    const left = roundMoney(p.amount - skip, c, rules);
    skip = 0;
    const portion = Math.min(left, remaining);
    const rate = getRate(data, c, bookCurrency, p.date);
    if (!rate.ok) return rate;
    slices.push({
      paymentId: p.id,
      date: p.date,
      amount: portion,
      rate: rate.value,
      book: roundMoney(portion * rate.value, bookCurrency, rules),
    });
    remaining = roundMoney(remaining - portion, c, rules);
  }
  if (remaining > 0) {
    return fail(`Advances on ${po.id} cover ${fmtMoney(roundMoney(amount - remaining, c, rules), c, rules)} of ${fmtMoney(amount, c, rules)}`);
  }
  return ok({
    method: "FIFO",
    slices,
    total: roundMoney(sum(slices.map((s) => s.book)), bookCurrency, rules),
    avgRate: null,
  });
}

/* --------------------------------------------------------- offset figures */

export interface OffsetInput {
  sourcePoId: string;
  targetBillId: string;
  amount: number;
  offset?: Pick<Offset, "id" | "createdAt"> | undefined;
}

export function computeOffsetFigures(data: Dataset, rules: Rules, input: OffsetInput): Result<OffsetFigures> {
  const po = findPo(data, input.sourcePoId);
  if (!po) return fail(`Source PO ${input.sourcePoId} not found`);
  const bill = findBill(data, input.targetBillId);
  if (!bill) return fail(`Target bill ${input.targetBillId} not found`);
  const entity = findEntity(data, po.entityId);
  if (!entity) return fail(`Entity ${po.entityId} not found`);
  const supplier = findSupplier(data, po.supplierId);
  const book = entity.bookCurrency;
  const c = po.currency;
  const amount = roundMoney(input.amount, c, rules);

  const consumed = advanceConsumedBefore(data, rules, po.id, input.offset);
  const adv = advanceSide(data, rules, po, book, amount, consumed);
  if (!adv.ok) return adv;

  const billRate = getRate(data, c, book, bill.date);
  if (!billRate.ok) return billRate;
  const billSide = roundMoney(amount * billRate.value, book, rules);
  const fx = roundMoney(billSide - adv.value.total, book, rules);

  const journal: JournalLine[] = [
    {
      account: "Accounts payable",
      description: `${supplier?.name ?? po.supplierId} · ${bill.id}`,
      debit: billSide,
      credit: 0,
    },
    {
      account: "Advances to suppliers",
      description: `${supplier?.name ?? po.supplierId} · ${po.id}`,
      debit: 0,
      credit: adv.value.total,
    },
  ];
  // The FX line absorbs any residual so the journal always balances.
  if (fx > 0) journal.push({ account: "Realised FX gain", description: `${c}/${book}`, debit: 0, credit: fx });
  if (fx < 0) journal.push({ account: "Realised FX loss", description: `${c}/${book}`, debit: -fx, credit: 0 });

  return ok({
    amount,
    currency: c,
    bookCurrency: book,
    method: adv.value.method,
    advanceSlices: adv.value.slices,
    advanceSide: adv.value.total,
    avgRate: adv.value.avgRate,
    billDate: bill.date,
    billRate: billRate.value,
    billSide,
    fx,
    journal,
    totalDebit: roundMoney(sum(journal.map((j) => j.debit)), book, rules),
    totalCredit: roundMoney(sum(journal.map((j) => j.credit)), book, rules),
  });
}

/** Frozen numbers once Posted; locked minutes numbers while awaiting signature / review; otherwise live. */
export function offsetDisplayFigures(data: Dataset, rules: Rules, offset: Offset): Result<OffsetFigures> {
  if (offset.frozen) return ok(offset.frozen);
  if ((offset.status === "Awaiting signature" || offset.status === "Pending review") && offset.minutes) {
    return ok(offset.minutes.figures);
  }
  return computeOffsetFigures(data, rules, {
    sourcePoId: offset.sourcePoId,
    targetBillId: offset.targetBillId,
    amount: offset.amount,
    offset,
  });
}

/** Is the offset amount still within the current max (ignoring itself)? */
export function offsetAmountCheck(data: Dataset, rules: Rules, offset: Offset): Result<OffsetLimits> {
  const lim = offsetLimits(data, rules, offset.sourcePoId, offset.targetBillId, offset.id);
  if (!lim.ok) return lim;
  if (offset.amount > lim.value.maxOffset) {
    return fail(
      `Amount is no longer valid: max is ${fmtMoney(lim.value.maxOffset, lim.value.po.currency, rules)} — ${lim.value.capText}`,
    );
  }
  const fig = computeOffsetFigures(data, rules, {
    sourcePoId: offset.sourcePoId,
    targetBillId: offset.targetBillId,
    amount: offset.amount,
    offset,
  });
  if (!fig.ok) return fig;
  return lim;
}

/* ------------------------------------------------------------ eligibility */

export interface BillEligibility {
  bill: Bill;
  figures: BillFigures;
  eligible: boolean;
  reason: string | null;
  sameSupplier: boolean;
}

export function billEligibility(
  data: Dataset,
  rules: Rules,
  sourcePoId: string,
  excludeOffsetId?: string | undefined,
): BillEligibility[] {
  const src = findPo(data, sourcePoId);
  if (!src) return [];
  const rows: BillEligibility[] = [];
  for (const bill of data.bills) {
    const figures = billFigures(data, rules, bill.id, { excludeOffsetId });
    if (!figures) continue;
    const bpo = figures.po;
    const sameSupplier = bpo?.supplierId === src.supplierId;
    let reason: string | null = null;
    if (!bpo) reason = `PO ${bill.poId} not found`;
    else if (!sameSupplier) reason = `Different supplier (${findSupplier(data, bpo.supplierId)?.name ?? bpo.supplierId})`;
    else if (bpo.entityId !== src.entityId)
      reason = `Different entity (${findEntity(data, bpo.entityId)?.name ?? bpo.entityId})`;
    else if (bpo.currency !== src.currency) reason = `Different currency (${bpo.currency})`;
    else if (bpo.id === src.id) reason = "On the source PO";
    else {
      const cap = roundMoney(figures.billOpen - figures.held - figures.inPaymentRun, figures.currency, rules);
      if (cap <= 0) {
        reason = "Nothing open to offset";
      }
    }
    rows.push({ bill, figures, eligible: reason === null, reason, sameSupplier });
  }
  const rank = (r: BillEligibility) => (r.eligible ? 0 : r.sameSupplier ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.bill.id.localeCompare(b.bill.id));
}

/* ------------------------------------------------------- supplier figures */

export interface UnusedCredit {
  po: PurchaseOrder;
  bookCurrency: Currency;
  credit: number;
  slices: AdvanceSlice[];
  historical: number;
  latestRate: number;
  latestRateDate: string;
  atLatest: number;
}

/** Unused credit on a PO in book currency: remaining advance slices at their own rates, and at the latest rate. */
export function unusedCreditBook(data: Dataset, rules: Rules, poId: string): Result<UnusedCredit> {
  const f = poFigures(data, rules, poId);
  if (!f) return fail(`PO ${poId} not found`);
  const credit = Math.max(0, f.creditOnPO);
  const consumed = roundMoney(f.advanceUsed + f.postedOut, f.currency, rules);
  const adv = advanceSide(data, rules, f.po, f.bookCurrency, credit, consumed);
  if (!adv.ok) return adv;
  const latest = latestRate(data, f.currency, f.bookCurrency, data.asOfDate);
  if (!latest.ok) return latest;
  return ok({
    po: f.po,
    bookCurrency: f.bookCurrency,
    credit,
    slices: adv.value.slices,
    historical: adv.value.total,
    latestRate: latest.value.rate,
    latestRateDate: latest.value.date,
    atLatest: roundMoney(credit * latest.value.rate, f.bookCurrency, rules),
  });
}

export interface CurrencyTotals {
  currency: Currency;
  openBills: number;
  credit: number;
  net: number;
}

export interface BookTotals {
  bookCurrency: Currency;
  historical: number;
  atLatest: number;
  difference: number;
  errors: string[];
}

export interface SupplierSummary {
  supplier: Supplier;
  pos: PoFigures[];
  bills: BillFigures[];
  byCurrency: CurrencyTotals[];
  byBook: BookTotals[];
}

export function supplierSummary(data: Dataset, rules: Rules, supplierId: string): SupplierSummary | null {
  const supplier = findSupplier(data, supplierId);
  if (!supplier) return null;
  const pos = data.purchaseOrders
    .filter((p) => p.supplierId === supplierId)
    .map((p) => poFigures(data, rules, p.id))
    .filter((x): x is PoFigures => x !== null);
  const poIds = new Set(pos.map((p) => p.po.id));
  const bills = data.bills
    .filter((b) => poIds.has(b.poId))
    .map((b) => billFigures(data, rules, b.id))
    .filter((x): x is BillFigures => x !== null);

  const currencies = [...new Set([...pos.map((p) => p.currency), ...bills.map((b) => b.currency)])].sort();
  const byCurrency = currencies.map((c) => {
    const openBills = roundMoney(sum(bills.filter((b) => b.currency === c).map((b) => b.billOpen)), c, rules);
    const credit = roundMoney(sum(pos.filter((p) => p.currency === c).map((p) => p.creditOnPO)), c, rules);
    return { currency: c, openBills, credit, net: roundMoney(openBills - credit, c, rules) };
  });

  const books = [...new Set(pos.map((p) => p.bookCurrency))].sort();
  const byBook = books.map((bc) => {
    let historical = 0;
    let atLatest = 0;
    const errors: string[] = [];
    for (const p of pos.filter((x) => x.bookCurrency === bc)) {
      if (p.creditOnPO <= 0) continue;
      const u = unusedCreditBook(data, rules, p.po.id);
      if (!u.ok) {
        errors.push(`${p.po.id}: ${u.error}`);
        continue;
      }
      historical += u.value.historical;
      atLatest += u.value.atLatest;
    }
    historical = roundMoney(historical, bc, rules);
    atLatest = roundMoney(atLatest, bc, rules);
    return { bookCurrency: bc, historical, atLatest, difference: roundMoney(atLatest - historical, bc, rules), errors };
  });

  return { supplier, pos, bills, byCurrency, byBook };
}

export interface SupplierCreditRow {
  supplier: Supplier;
  bookCurrency: Currency;
  entities: string[];
  credits: { currency: Currency; credit: number }[];
  historical: number;
  atLatest: number;
  difference: number;
  errors: string[];
}

/** All suppliers by unused credit in book currency (one row per supplier and book currency). */
export function supplierCreditRanking(data: Dataset, rules: Rules): SupplierCreditRow[] {
  const rows: SupplierCreditRow[] = [];
  for (const s of data.suppliers) {
    const sum_ = supplierSummary(data, rules, s.id);
    if (!sum_) continue;
    for (const b of sum_.byBook) {
      const pos = sum_.pos.filter((p) => p.bookCurrency === b.bookCurrency);
      const currencies = [...new Set(pos.map((p) => p.currency))].sort();
      rows.push({
        supplier: s,
        bookCurrency: b.bookCurrency,
        entities: [...new Set(pos.map((p) => p.entity?.name ?? p.po.entityId))],
        credits: currencies.map((c) => ({
          currency: c,
          credit: roundMoney(sum(pos.filter((p) => p.currency === c).map((p) => p.creditOnPO)), c, rules),
        })),
        historical: b.historical,
        atLatest: b.atLatest,
        difference: b.difference,
        errors: b.errors,
      });
    }
  }
  return rows.sort((a, b) =>
    a.bookCurrency === b.bookCurrency ? b.historical - a.historical : a.bookCurrency.localeCompare(b.bookCurrency),
  );
}

/* ---------------------------------------------------------- SO attribution */

/** Largest-remainder allocation of `total` across `weights`, in currency minor units. */
export function allocateLargestRemainder(total: number, weights: number[], decimals: number): number[] {
  const f = 10 ** decimals;
  const units = Math.round(Number((total * f).toPrecision(15)));
  const wTotal = sum(weights);
  if (wTotal <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => Number(((units * w) / wTotal).toPrecision(15)));
  const floors = raw.map((r) => Math.floor(r));
  let left = units - sum(floors);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i] = (floors[o.i] ?? 0) + 1;
    left -= 1;
  }
  return floors.map((u) => u / f);
}

export function attributionBasisPoIds(data: Dataset, basis: AttributionBasis, sourcePoId: string, targetBillId: string): string[] {
  if (basis === "SOURCE_PO") return [sourcePoId];
  const billPo = findBill(data, targetBillId)?.poId;
  return [...new Set([sourcePoId, ...(billPo ? [billPo] : [])])];
}

export function liveAttributionBasis(
  data: Dataset,
  basis: AttributionBasis,
  sourcePoId: string,
  targetBillId: string,
): { rows: AttributionBasisRow[]; allIssued: boolean; shipmentCount: number } {
  const poIds = new Set(attributionBasisPoIds(data, basis, sourcePoId, targetBillId));
  const ships = data.shipments.filter((s) => poIds.has(s.poId));
  const bySo = new Map<string, number>();
  for (const s of ships) bySo.set(s.soId, (bySo.get(s.soId) ?? 0) + s.qty);
  const rows = [...bySo.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([soId, qty]) => ({ soId, qty }));
  return { rows, allIssued: ships.length > 0 && ships.every((s) => s.blIssued), shipmentCount: ships.length };
}

export interface AttributionRow {
  soId: string;
  so: SalesOrder | undefined;
  entityName: string;
  otherEntity: boolean;
  qty: number;
  share: number;
  amount: number;
}

export interface Attribution {
  basis: AttributionBasis;
  basisPoIds: string[];
  frozen: boolean;
  totalQty: number;
  currency: Currency;
  amount: number;
  rows: AttributionRow[];
}

export function soAttribution(
  data: Dataset,
  rules: Rules,
  offset: Pick<Offset, "sourcePoId" | "targetBillId" | "amount"> & {
    frozenAttribution?: Offset["frozenAttribution"] | undefined;
  },
): Result<Attribution> {
  const po = findPo(data, offset.sourcePoId);
  if (!po) return fail(`Source PO ${offset.sourcePoId} not found`);
  const basis = rules.attributionBasis;
  const frozenRows = offset.frozenAttribution?.[basis];
  const basisRows = frozenRows ?? liveAttributionBasis(data, basis, offset.sourcePoId, offset.targetBillId).rows;
  const totalQty = sum(basisRows.map((r) => r.qty));
  const amounts = allocateLargestRemainder(
    offset.amount,
    basisRows.map((r) => r.qty),
    currencyDecimals(po.currency, rules),
  );
  return ok({
    basis,
    basisPoIds: attributionBasisPoIds(data, basis, offset.sourcePoId, offset.targetBillId),
    frozen: !!frozenRows,
    totalQty,
    currency: po.currency,
    amount: offset.amount,
    rows: basisRows.map((r, i) => {
      const so = findSo(data, r.soId);
      return {
        soId: r.soId,
        so,
        entityName: so ? (findEntity(data, so.entityId)?.name ?? so.entityId) : "—",
        otherEntity: !!so && so.entityId !== po.entityId,
        qty: r.qty,
        share: totalQty > 0 ? r.qty / totalQty : 0,
        amount: amounts[i] ?? 0,
      };
    }),
  });
}

/**
 * Freeze each offset's attribution basis once every basis shipment has its B/L issued;
 * unfreeze (recalculate live) while any basis shipment's B/L is not issued.
 */
export function reconcileOffsets(data: Dataset): Dataset {
  let changed = false;
  const offsets = data.offsets.map((o) => {
    if (o.status === "Cancelled") return o;
    const next: Offset["frozenAttribution"] = { ...o.frozenAttribution };
    let touched = false;
    for (const basis of ["SOURCE_PO", "BOTH_POS"] as AttributionBasis[]) {
      const live = liveAttributionBasis(data, basis, o.sourcePoId, o.targetBillId);
      if (live.allIssued && !next[basis]) {
        next[basis] = live.rows;
        touched = true;
      } else if (!live.allIssued && next[basis]) {
        delete next[basis];
        touched = true;
      }
    }
    if (!touched) return o;
    changed = true;
    return { ...o, frozenAttribution: next };
  });
  return changed ? { ...data, offsets } : data;
}

/* ------------------------------------------------------------ review queue */

export function reviewQueue(data: Dataset): Offset[] {
  const due = (o: Offset) => findBill(data, o.targetBillId)?.dueDate ?? "9999-12-31";
  return data.offsets
    .filter((o) => isActiveStatus(o.status))
    .sort((a, b) => {
      const pa = a.status === "Pending review" ? 0 : 1;
      const pb = b.status === "Pending review" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (due(a) !== due(b)) return due(a) < due(b) ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
}

export function pendingReviewCount(data: Dataset): number {
  return data.offsets.filter((o) => o.status === "Pending review").length;
}
