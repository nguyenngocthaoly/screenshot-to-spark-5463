import { describe, expect, it } from "vitest";
import { cloneSeed } from "@/data/seed";
import { cloneDefaultRules } from "@/config/rules";
import type { Dataset, Offset, Role } from "@/data/types";
import { offsetLimits, validateOffsetAmount } from "@/lib/offsetCalc";
import { attachSignedFile, createOffsetDraft, offsetCreditState, runOffsetAction, setSignedAmount, targetBillChoices, updateOffsetDraft, type ActionId, type Session } from "@/lib/offsetWorkflow";
import { getState, personaLanding, personaOverviewTab, resetDemo, setPersona } from "@/lib/store";

const purchasing: Session = { role: "Purchasing", userName: "Linh" };
const accounting: Session = { role: "Accounting", userName: "Huệ" };
const rules = cloneDefaultRules();
function first(data: Dataset): Offset {
  const o = data.offsets[0];
  if (!o) throw new Error("Missing offset");
  return o;
}
function draft(data = cloneSeed(), amountRaw = "4800") {
  const r = createOffsetDraft(data, rules, purchasing, { sourcePoId: "PO-101", targetBillId: "BILL-102", amountRaw });
  if (!r.ok) throw new Error(r.error);
  return r.value.data;
}
function action(data: Dataset, id: ActionId, session = purchasing, reason = "Correction") {
  const r = runOffsetAction(data, rules, session, first(data).id, id, { reason });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
function review(data: Dataset) {
  if (first(data).status === "Draft") data = action(data, "generate-minutes");
  const attached = attachSignedFile(data, purchasing, first(data).id, { name: "signed.pdf", size: 1 });
  if (!attached.ok) throw new Error(attached.error);
  const amount = setSignedAmount(attached.value, purchasing, first(data).id, String(first(data).amount));
  if (!amount.ok) throw new Error(amount.error);
  return action(amount.value, "submit");
}

describe("personas", () => {
  it.each([
    ["U-1", "Linh", "Purchasing", "/", "queue"],
    ["U-2", "Huệ", "Accounting", "/overview", "queue"],
    ["U-3", "Thảo", "Accounting", "/overview", "queue"],
    ["U-4", "Mai", "Finance", "/overview", "credit"],
    ["U-5", "Tuấn", "Account manager", "/", "queue"],
  ] as const)("%s derives role and landing from the person", (id, name, role, landing, tab) => {
    resetDemo(); setPersona(id);
    expect(getState().userName).toBe(name);
    expect(getState().role).toBe(role);
    expect(personaLanding(getState().role)).toBe(landing);
    expect(personaOverviewTab(getState().role)).toBe(tab);
  });
});

describe("target bills and credit states", () => {
  it("shows only same-supplier bills, including ineligible bills", () => {
    const choices = targetBillChoices(cloneSeed(), rules, "PO-101");
    expect(choices.bills.map((b) => b.bill.id)).toEqual(["BILL-102", "BILL-101"]);
    expect(choices.bills.find((b) => b.bill.id === "BILL-101")?.eligible).toBe(false);
    expect(choices.hiddenCount).toBe(5);
  });
  it("keeps other-entity, other-currency, and fully paid same-supplier bills", () => {
    const data = cloneSeed();
    data.purchaseOrders.push(
      { id: "PO-X", supplierId: "SUP-1", entityId: "ENT-B", currency: "USD", status: "Received", qtyOrdered: 1, qtyReceived: 1, unitPrice: 100 },
      { id: "PO-Y", supplierId: "SUP-1", entityId: "ENT-A", currency: "VND", status: "Received", qtyOrdered: 1, qtyReceived: 1, unitPrice: 100 },
      { id: "PO-Z", supplierId: "SUP-1", entityId: "ENT-A", currency: "USD", status: "Received", qtyOrdered: 1, qtyReceived: 1, unitPrice: 100 },
    );
    for (const x of ["X", "Y", "Z"]) data.bills.push({ id: `BILL-${x}`, poId: `PO-${x}`, date: data.asOfDate, dueDate: data.asOfDate, amount: 100, settledFromAdvance: 0, paidInCash: x === "Z" ? 100 : 0, inPaymentRun: 0 });
    const choices = targetBillChoices(data, rules, "PO-101");
    for (const id of ["BILL-X", "BILL-Y", "BILL-Z"]) expect(choices.bills.find((b) => b.bill.id === id)?.eligible).toBe(false);
    expect(choices.bills).toHaveLength(5);
    expect(choices.hiddenCount).toBe(5);
  });
  it("uses a neutral state for zero credit and no reserves", () => {
    expect(offsetCreditState(cloneSeed(), rules, purchasing, "PO-102")).toBe("no-credit");
  });
  it("retains blocks for open POs, wrong roles and fully reserved credit", () => {
    expect(offsetCreditState(cloneSeed(), rules, purchasing, "PO-202")).toBe("blocked");
    expect(offsetCreditState(cloneSeed(), rules, accounting, "PO-101")).toBe("blocked");
    expect(offsetCreditState(draft(), rules, purchasing, "PO-101")).toBe("blocked");
  });
  it("keeps the 3,000 payment-run cap", () => {
    const data = cloneSeed();
    data.payments.push({ id: "PAY-EXTRA", poId: "PO-101", type: "Advance", date: "2026-09-20", amount: 10000 });
    data.bills = data.bills.map((b) => b.id === "BILL-102" ? { ...b, inPaymentRun: 9000 } : b);
    const lim = offsetLimits(data, rules, "PO-101", "BILL-102");
    if (!lim.ok) throw new Error(lim.error);
    expect(lim.value.maxOffset).toBe(3000);
    expect(validateOffsetAmount("3000", lim.value, rules).ok).toBe(true);
    expect(validateOffsetAmount("3000.01", lim.value, rules).ok).toBe(false);
  });
  it("keeps 1,800 available when OFS-0001 reserves 3,000", () => {
    const lim = offsetLimits(draft(cloneSeed(), "3000"), rules, "PO-101", "BILL-102");
    if (!lim.ok) throw new Error(lim.error);
    expect(lim.value.maxOffset).toBe(1800);
    expect(lim.value.po.reservedBy.map((o) => o.id)).toEqual(["OFS-0001"]);
    expect(validateOffsetAmount("1800.01", lim.value, rules).ok).toBe(false);
  });
});

describe("cancellation", () => {
  for (const status of ["Draft", "Awaiting signature", "Pending review"] as const) {
    it.each(["Purchasing", "Accounting"] as const)(`allows %s to cancel ${status}`, (role) => {
      let data = draft();
      if (status === "Awaiting signature") data = action(data, "generate-minutes");
      if (status === "Pending review") data = review(data);
      expect(first(action(data, "cancel", { role, userName: role === "Purchasing" ? "Linh" : "Huệ" })).status).toBe("Cancelled");
    });
  }
  it.each(["Finance", "Account manager"] as Role[])("blocks %s from cancellation", (role) => {
    const data = draft();
    expect(runOffsetAction(data, rules, { role, userName: "Other" }, first(data).id, "cancel").ok).toBe(false);
  });
  it("cannot cancel posted or reversed offsets", () => {
    const posted = action(review(draft()), "approve-post", accounting);
    expect(runOffsetAction(posted, rules, accounting, first(posted).id, "cancel").ok).toBe(false);
    const reversed = action(posted, "reverse", accounting);
    expect(runOffsetAction(reversed, rules, purchasing, first(reversed).id, "cancel").ok).toBe(false);
  });
});

describe("document IDs and reversal", () => {
  it.each([
    ["sourcePoCredit", 4800],
    ["targetBillOpen", 12000],
    ["offsetAmount", 4800],
    ["targetBillAfter", 7200],
  ] as const)("locks minutes %s at generation, even after balances change", (field, expected) => {
    const generated = action(draft(), "generate-minutes");
    expect(first(generated).minutes?.balances?.[field]).toBe(expected);
    const changed = {
      ...generated,
      payments: generated.payments.map((p) => p.poId === "PO-101" ? { ...p, amount: p.amount + 1000 } : p),
      bills: generated.bills.map((b) => b.id === "BILL-102" ? { ...b, amount: 20000 } : b),
    };
    const posted = action(review(changed), "approve-post", accounting);
    expect(first(posted).minutes?.balances?.[field]).toBe(expected);
    expect(first(action(posted, "reverse", accounting)).minutes?.balances?.[field]).toBe(expected);
  });
  it("captures fresh balances only after voiding and regenerating minutes", () => {
    let data = action(draft(), "generate-minutes");
    data = { ...data, bills: data.bills.map((b) => b.id === "BILL-102" ? { ...b, amount: 20000 } : b) };
    const edited = updateOffsetDraft(data, rules, purchasing, first(data).id, { sourcePoId: "PO-101", targetBillId: "BILL-102", amountRaw: "4800" });
    if (!edited.ok) throw new Error(edited.error);
    const regenerated = action(edited.value, "generate-minutes");
    expect(first(regenerated).minutes?.balances?.targetBillOpen).toBe(20000);
    expect(first(regenerated).minutes?.balances?.targetBillAfter).toBe(15200);
    expect(first(regenerated).voidedMinutes[0]?.balances?.targetBillAfter).toBe(7200);
  });
  it("assigns JE-2026-11-001 then JE-2026-11-002 and freezes swapped lines", () => {
    const posted = action(review(draft()), "approve-post", accounting);
    const original = structuredClone(first(posted).frozen);
    expect(first(posted).journalId).toBe("JE-2026-11-001");
    expect(first(posted).history.at(-1)?.note).toContain("JE-2026-11-001");
    const changed = { ...posted, fxRates: posted.fxRates.map((r) => ({ ...r, rate: r.rate + 1000 })) };
    const reversed = action(changed, "reverse", accounting);
    const o = first(reversed);
    expect(o.journalId).toBe("JE-2026-11-001");
    expect(o.reversal?.journalId).toBe("JE-2026-11-002");
    expect(o.history.at(-1)?.note).toContain("JE-2026-11-002");
    expect(o.frozen).toEqual(original);
    if (!original) throw new Error("Missing original journal");
    expect(o.reversal?.journal).toEqual(original.journal.map((j) => ({ ...j, debit: j.credit, credit: j.debit })));
    expect(o.frozen?.fx).toBe(336000);
    const nextDraft = draft(reversed);
    const nextPosted = action(review({ ...nextDraft, offsets: [...nextDraft.offsets].reverse() }), "approve-post", accounting);
    expect(first(nextPosted).journalId).toBe("JE-2026-11-003");
  });
  it("starts journal sequence again in the next month", () => {
    const posted = action(review(draft()), "approve-post", accounting);
    const reversed = action({ ...posted, asOfDate: "2026-12-01" }, "reverse", accounting);
    expect(first(reversed).reversal?.journalId).toBe("JE-2026-12-001");
  });
  it("numbers monthly minutes and keeps suffixes after voiding", () => {
    let data = action(draft(cloneSeed(), "1000"), "generate-minutes");
    expect(first(data).minutes?.number).toBe("BBCTCN-2026-11-001");
    for (const revision of [2, 3]) {
      const updated = updateOffsetDraft(data, rules, purchasing, first(data).id, { sourcePoId: "PO-101", targetBillId: "BILL-102", amountRaw: "1000" });
      if (!updated.ok) throw new Error(updated.error);
      data = action(updated.value, "generate-minutes");
      expect(first(data).minutes?.number).toBe(`BBCTCN-2026-11-001-${revision}`);
    }
    const second = draft(data, "1000");
    const id = second.offsets.at(-1)?.id;
    if (!id) throw new Error("Missing second draft");
    const generated = runOffsetAction(second, rules, purchasing, id, "generate-minutes");
    if (!generated.ok) throw new Error(generated.error);
    expect(generated.value.offsets.at(-1)?.minutes?.number).toBe("BBCTCN-2026-11-002");
    const december = draft({ ...generated.value, asOfDate: "2026-12-01" }, "1000");
    const decemberId = december.offsets.at(-1)?.id;
    if (!decemberId) throw new Error("Missing December draft");
    const result = runOffsetAction(december, rules, purchasing, decemberId, "generate-minutes");
    if (!result.ok) throw new Error(result.error);
    expect(result.value.offsets.at(-1)?.minutes?.number).toBe("BBCTCN-2026-12-001");
  });
});
