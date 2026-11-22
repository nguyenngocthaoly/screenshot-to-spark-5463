/** Self-check cases run against the seed data (used by /tests and the unit tests). */
import { cloneDefaultRules } from "@/config/rules";
import { cloneSeed } from "@/data/seed";
import {
  billFigures,
  computeOffsetFigures,
  poFigures,
  soAttribution,
  unusedCreditBook,
} from "./offsetCalc";
import { createOffsetDraft } from "./offsetWorkflow";

export interface CheckResult {
  name: string;
  expected: number;
  actual: number | null;
  pass: boolean;
  detail?: string | undefined;
}

export function runSelfChecks(): CheckResult[] {
  const data = cloneSeed();
  const rules = cloneDefaultRules();
  const out: CheckResult[] = [];
  const check = (name: string, expected: number, actual: number | null, detail?: string) =>
    out.push({ name, expected, actual, pass: actual !== null && Math.abs(actual - expected) < 1e-9, detail });

  check("PO-101 available (USD)", 4800, poFigures(data, rules, "PO-101")?.available ?? null);

  const u = unusedCreditBook(data, rules, "PO-101");
  check("PO-101 credit in VND", 121_248_000, u.ok ? u.value.historical : null, u.ok ? undefined : u.error);

  const fig = computeOffsetFigures(data, rules, { sourcePoId: "PO-101", targetBillId: "BILL-102", amount: 4800 });
  check("Offset 4,800 PO-101 → BILL-102: bill side (VND)", 121_584_000, fig.ok ? fig.value.billSide : null, fig.ok ? undefined : fig.error);
  check("Offset 4,800 PO-101 → BILL-102: FX gain (VND)", 336_000, fig.ok ? fig.value.fx : null, fig.ok ? undefined : fig.error);

  const created = createOffsetDraft(data, rules, { role: "Purchasing", userName: "Self-check" }, {
    sourcePoId: "PO-101",
    targetBillId: "BILL-102",
    amountRaw: "4,800",
  });
  check(
    "BILL-102 payable now after the offset (USD)",
    7200,
    created.ok ? (billFigures(created.value.data, rules, "BILL-102")?.payableNow ?? null) : null,
    created.ok ? undefined : created.error,
  );

  const attr = soAttribution(data, { ...rules, attributionBasis: "SOURCE_PO" }, {
    sourcePoId: "PO-101",
    targetBillId: "BILL-102",
    amount: 4800,
  });
  const row = (id: string) => (attr.ok ? (attr.value.rows.find((r) => r.soId === id)?.amount ?? null) : null);
  check("SO attribution (source PO): SO-A", 3789.47, row("SO-A"));
  check("SO attribution (source PO): SO-B", 1010.53, row("SO-B"));
  return out;
}
