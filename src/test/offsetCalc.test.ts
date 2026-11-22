import { describe, expect, it } from "vitest";
import { cloneDefaultRules } from "@/config/rules";
import { cloneSeed } from "@/data/seed";
import { runSelfChecks } from "@/lib/selfCheck";
import {
  offsetLimits,
  parseAmountInput,
  roundHalfUp,
  validateOffsetAmount,
} from "@/lib/offsetCalc";
import { createOffsetDraft, offsetActions, offsetCreditBlockers, runOffsetAction } from "@/lib/offsetWorkflow";

const purchasing = { role: "Purchasing" as const, userName: "Mai Tran" };
const accounting = { role: "Accounting" as const, userName: "Hoa Pham" };

describe("self-check on seed data", () => {
  for (const c of runSelfChecks()) {
    it(c.name, () => {
      expect(c.actual).toBe(c.expected);
    });
  }
});

describe("amount input", () => {
  it("accepts 4800, 4,800 and 4.8k", () => {
    for (const s of ["4800", "4,800", "4.8k"]) {
      const r = parseAmountInput(s);
      expect(r.ok && r.value.value).toBe(4800);
    }
  });
  it("blocks above the max and names the limiting figure", () => {
    const lim = offsetLimits(cloneSeed(), cloneDefaultRules(), "PO-101", "BILL-102");
    if (!lim.ok) throw new Error(lim.error);
    const r = validateOffsetAmount("4,800.01", lim.value, cloneDefaultRules());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("PO-101 available credit");
  });
  it("blocks more than 2 decimals", () => {
    const lim = offsetLimits(cloneSeed(), cloneDefaultRules(), "PO-101", "BILL-102");
    if (!lim.ok) throw new Error(lim.error);
    expect(validateOffsetAmount("100.123", lim.value, cloneDefaultRules()).ok).toBe(false);
  });
  it("rounds half-up", () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.5, 0)).toBe(3);
  });
});

describe("blocking rules", () => {
  it("blocks offset credit from an Open PO while the rule is on", () => {
    const b = offsetCreditBlockers(cloneSeed(), cloneDefaultRules(), purchasing, "PO-202");
    expect(b.some((x) => x.includes("still Open"))).toBe(true);
  });
  it("caps BILL-202 by its payment run (7,800 − 3,000 = 4,800)", () => {
    const lim = offsetLimits(cloneSeed(), cloneDefaultRules(), "PO-201", "BILL-202");
    expect(lim.ok && lim.value.maxOffset).toBe(4800);
    expect(lim.ok && lim.value.cap).toBe("bill");
  });
  it("blocks self-approval and needs two approvers above the threshold", () => {
    const rules = { ...cloneDefaultRules(), secondApproverAbove: 4000 };
    const c = createOffsetDraft(cloneSeed(), rules, purchasing, {
      sourcePoId: "PO-101",
      targetBillId: "BILL-102",
      amountRaw: "4800",
    });
    if (!c.ok) throw new Error(c.error);
    let d = c.value.data;
    const id = c.value.offsetId;
    const step = (s: typeof purchasing | typeof accounting, a: Parameters<typeof runOffsetAction>[4]) => {
      const r = runOffsetAction(d, rules, s, id, a);
      if (!r.ok) throw new Error(r.error);
      d = r.value;
    };
    step(purchasing, "generate-minutes");
    d = { ...d, offsets: d.offsets.map((o) => ({ ...o, signedFile: { name: "x.pdf", size: 1, uploadedAt: "", uploadedBy: "" }, signedAmountRaw: "4,800" })) };
    step(purchasing, "submit");
    const self = offsetActions(d, rules, { role: "Accounting", userName: "Mai Tran" }, d.offsets[0]!);
    expect(self.find((a) => a.id === "approve-post")?.blockers.some((b) => b.includes("self-approval"))).toBe(true);
    step(accounting, "approve");
    const same = offsetActions(d, rules, accounting, d.offsets[0]!).find((a) => a.id === "approve-post");
    expect(same?.blockers.length).toBeGreaterThan(0);
    step({ role: "Accounting", userName: "Tuan Vo" } as typeof accounting, "approve-post");
    expect(d.offsets[0]?.status).toBe("Posted");
    expect(d.offsets[0]?.frozen?.fx).toBe(336000);
  });
});
