/**
 * Offset workflow: permissions, status transitions and blocked reasons.
 * All numbers come from offsetCalc.
 */
import type { Rules } from "@/config/rules";
import type { Dataset, Offset, OffsetStatus, Role } from "@/data/types";
import {
  billEligibility,
  computeOffsetFigures,
  fail,
  findOffset,
  findPo,
  fmtMoney,
  isActiveStatus,
  monthOf,
  offsetAmountCheck,
  offsetLimits,
  ok,
  parseAmountInput,
  poFigures,
  reconcileOffsets,
  validateOffsetAmount,
  type Result,
} from "./offsetCalc";

export interface Session {
  role: Role;
  userName: string;
}

export const STATUS_FLOW: OffsetStatus[] = ["Draft", "Awaiting signature", "Pending review", "Posted"];

function stamp(data: Dataset): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${data.asOfDate} ${hh}:${mm}:${ss}`;
}

function nextOffsetId(data: Dataset): string {
  const max = data.offsets.reduce((m, o) => {
    const n = Number(/(\d+)$/.exec(o.id)?.[1] ?? 0);
    return n > m ? n : m;
  }, 0);
  return `OFS-${String(max + 1).padStart(4, "0")}`;
}

/** Both journal types share one monthly sequence; minutes have their own. */
function nextDocumentNumber(data: Dataset, prefix: "JE" | "BBCTCN"): string {
  const month = monthOf(data.asOfDate);
  const pattern = new RegExp(`^${prefix}-${month}-(\\d{3,})(?:-\\d+)?$`);
  const numbers = data.offsets.flatMap((o) => prefix === "JE"
    ? [o.journalId, o.reversal?.journalId]
    : [o.minutes?.number, ...o.voidedMinutes.map((m) => m.number)]);
  const max = numbers.reduce((n, value) => Math.max(n, Number(value?.match(pattern)?.[1] ?? 0)), 0);
  return `${prefix}-${month}-${String(max + 1).padStart(3, "0")}`;
}

function log(offset: Offset, data: Dataset, session: Session, action: string, note?: string): Offset {
  return {
    ...offset,
    history: [...offset.history, { at: stamp(data), by: session.userName, role: session.role, action, note }],
  };
}

function replace(data: Dataset, offset: Offset): Dataset {
  return reconcileOffsets({ ...data, offsets: data.offsets.map((o) => (o.id === offset.id ? offset : o)) });
}

const roleBlock = (session: Session, role: Role, verb: string) =>
  session.role === role ? null : `Only ${role} can ${verb}`;

/* ------------------------------------------------------- offset credit gate */

export function offsetCreditBlockers(data: Dataset, rules: Rules, session: Session, poId: string): string[] {
  const reasons: string[] = [];
  const r = roleBlock(session, "Purchasing", "offset credit");
  if (r) reasons.push(r);
  const f = poFigures(data, rules, poId);
  if (!f) return [...reasons, `PO ${poId} not found`];
  if (f.po.status === "Open" && rules.requireSourcePoClosed) {
    reasons.push(`${f.po.id} is still Open`);
  }
  if (f.available <= 0) {
    reasons.push(
      f.reserved > 0 ? `Credit fully reserved by ${f.reservedBy.map((o) => o.id).join(", ")}` : "No credit to offset",
    );
  }
  if (!billEligibility(data, rules, poId).some((b) => b.eligible)) {
    reasons.push("No eligible bill");
  }
  return reasons;
}

/** Visible target choices are supplier-scoped; eligibility reasons stay intact. */
export function targetBillChoices(data: Dataset, rules: Rules, poId: string, offsetId?: string) {
  const all = billEligibility(data, rules, poId, offsetId);
  return { bills: all.filter((b) => b.sameSupplier), hiddenCount: all.filter((b) => !b.sameSupplier).length };
}

export function offsetCreditState(data: Dataset, rules: Rules, session: Session, poId: string) {
  const po = poFigures(data, rules, poId);
  if (po && po.creditOnPO === 0 && po.reserved === 0) return "no-credit";
  return offsetCreditBlockers(data, rules, session, poId).length ? "blocked" : "available";
}

/* ------------------------------------------------------------ create/edit */

export interface DraftInput {
  sourcePoId: string;
  targetBillId: string;
  amountRaw: string;
}

function validateDraft(
  data: Dataset,
  rules: Rules,
  input: DraftInput,
  existing?: Offset | undefined,
): Result<number> {
  const elig = billEligibility(data, rules, input.sourcePoId, existing?.id).find(
    (b) => b.bill.id === input.targetBillId,
  );
  if (!elig) return fail("Choose an eligible bill");
  if (!elig.eligible) return fail(elig.reason ?? "Choose an eligible bill");
  const lim = offsetLimits(data, rules, input.sourcePoId, input.targetBillId, existing?.id);
  if (!lim.ok) return lim;
  const amt = validateOffsetAmount(input.amountRaw, lim.value, rules);
  if (!amt.ok) return amt;
  const fig = computeOffsetFigures(data, rules, {
    sourcePoId: input.sourcePoId,
    targetBillId: input.targetBillId,
    amount: amt.value,
    offset: existing,
  });
  if (!fig.ok) return fig;
  return amt;
}

export function createOffsetDraft(
  data: Dataset,
  rules: Rules,
  session: Session,
  input: DraftInput,
): Result<{ data: Dataset; offsetId: string }> {
  const blockers = offsetCreditBlockers(data, rules, session, input.sourcePoId);
  if (blockers.length) return fail(blockers[0] ?? "Cannot create offset");
  const amt = validateDraft(data, rules, input);
  if (!amt.ok) return amt;
  const id = nextOffsetId(data);
  let offset: Offset = {
    id,
    sourcePoId: input.sourcePoId,
    targetBillId: input.targetBillId,
    amount: amt.value,
    status: "Draft",
    createdBy: session.userName,
    createdAt: stamp(data),
    minutes: null,
    voidedMinutes: [],
    signedFile: null,
    signedAmountRaw: "",
    approvals: [],
    frozen: null,
    postedAt: null,
    postedBy: null,
    postingDate: null,
    reversal: null,
    frozenAttribution: {},
    history: [],
  };
  const po = findPo(data, input.sourcePoId);
  offset = log(offset, data, session, "Created draft", `${fmtMoney(amt.value, po?.currency ?? "", rules)} ${input.sourcePoId} → ${input.targetBillId}`);
  return ok({ data: reconcileOffsets({ ...data, offsets: [...data.offsets, offset] }), offsetId: id });
}

function voidMinutes(offset: Offset): Offset {
  return {
    ...offset,
    minutes: null,
    voidedMinutes: offset.minutes ? [...offset.voidedMinutes, { ...offset.minutes, voided: true }] : offset.voidedMinutes,
    signedFile: null,
    signedAmountRaw: "",
    approvals: [],
  };
}

export function editBlockers(session: Session, offset: Offset): string[] {
  const out: string[] = [];
  const r = roleBlock(session, "Purchasing", "edit offsets");
  if (r) out.push(r);
  if (offset.status !== "Draft" && offset.status !== "Awaiting signature") {
    out.push(
      offset.status === "Posted" || offset.status === "Reversed"
        ? "Posted offsets cannot be edited"
        : `Cannot edit in ${offset.status}`,
    );
  }
  return out;
}

export function updateOffsetDraft(
  data: Dataset,
  rules: Rules,
  session: Session,
  offsetId: string,
  input: DraftInput,
): Result<Dataset> {
  const offset = findOffset(data, offsetId);
  if (!offset) return fail(`Offset ${offsetId} not found`);
  const b = editBlockers(session, offset);
  if (b.length) return fail(b[0] ?? "Cannot edit offset");
  if (input.sourcePoId !== offset.sourcePoId) return fail("The source PO of an offset cannot change");
  const amt = validateDraft(data, rules, input, offset);
  if (!amt.ok) return amt;
  const wasAwaiting = offset.status === "Awaiting signature";
  let next: Offset = { ...offset, targetBillId: input.targetBillId, amount: amt.value };
  if (wasAwaiting) next = { ...voidMinutes(next), status: "Draft" };
  const po = findPo(data, offset.sourcePoId);
  next = log(
    next,
    data,
    session,
    wasAwaiting ? "Edited — returned to Draft, minutes voided" : "Edited draft",
    `${fmtMoney(amt.value, po?.currency ?? "", rules)} → ${input.targetBillId}`,
  );
  return ok(replace(data, next));
}

/* --------------------------------------------------------- minutes inputs */

export function attachSignedFile(
  data: Dataset,
  session: Session,
  offsetId: string,
  file: { name: string; size: number } | null,
): Result<Dataset> {
  const offset = findOffset(data, offsetId);
  if (!offset) return fail(`Offset ${offsetId} not found`);
  const r = roleBlock(session, "Purchasing", "attach signed minutes");
  if (r) return fail(r);
  if (offset.status !== "Awaiting signature") return fail("Signed minutes can only be attached while awaiting signature");
  let next: Offset = {
    ...offset,
    signedFile: file ? { ...file, uploadedAt: stamp(data), uploadedBy: session.userName } : null,
  };
  next = log(next, data, session, file ? "Attached signed minutes" : "Removed signed minutes", file?.name);
  return ok(replace(data, next));
}

export function setSignedAmount(data: Dataset, session: Session, offsetId: string, raw: string): Result<Dataset> {
  const offset = findOffset(data, offsetId);
  if (!offset) return fail(`Offset ${offsetId} not found`);
  if (session.role !== "Purchasing" || offset.status !== "Awaiting signature") return fail("Not editable");
  return ok({ ...data, offsets: data.offsets.map((o) => (o.id === offsetId ? { ...o, signedAmountRaw: raw } : o)) });
}

/* ---------------------------------------------------------------- actions */

export type ActionId = "edit" | "generate-minutes" | "submit" | "approve" | "approve-post" | "return" | "cancel" | "reverse";

export interface OffsetAction {
  id: ActionId;
  label: string;
  blockers: string[];
  needsReason: boolean;
  tone: "primary" | "secondary" | "danger";
}

function needsSecondApprover(rules: Rules, offset: Offset): boolean {
  return rules.secondApproverAbove !== null && offset.amount > rules.secondApproverAbove;
}

function approvalBlockers(data: Dataset, rules: Rules, session: Session, offset: Offset): string[] {
  const out: string[] = [];
  const r = roleBlock(session, "Accounting", "approve");
  if (r) out.push(r);
  if (offset.status !== "Pending review") out.push(`Offset is ${offset.status}, not Pending review`);
  if (!rules.allowSelfApproval && session.userName === offset.createdBy) {
    out.push(`${session.userName} created this offset — self-approval is not allowed`);
  }
  const period = monthOf(data.asOfDate);
  if (rules.closedPeriods.includes(period)) out.push(`Period ${period} is closed`);
  const check = offsetAmountCheck(data, rules, offset);
  if (!check.ok) out.push(check.error);
  return out;
}

export function offsetActions(data: Dataset, rules: Rules, session: Session, offset: Offset): OffsetAction[] {
  const po = findPo(data, offset.sourcePoId);
  const c = po?.currency ?? "";
  const actions: OffsetAction[] = [];
  const s = offset.status;

  if (s === "Draft" || s === "Awaiting signature") {
    actions.push({
      id: "edit",
      label: s === "Awaiting signature" ? "Edit (voids minutes)" : "Edit",
      blockers: editBlockers(session, offset),
      needsReason: false,
      tone: "secondary",
    });
  }
  if (s === "Draft") {
    const b: string[] = [];
    const r = roleBlock(session, "Purchasing", "generate minutes");
    if (r) b.push(r);
    const check = offsetAmountCheck(data, rules, offset);
    if (!check.ok) b.push(check.error);
    actions.push({ id: "generate-minutes", label: "Generate minutes", blockers: b, needsReason: false, tone: "primary" });
  }
  if (s === "Awaiting signature") {
    const b: string[] = [];
    const r = roleBlock(session, "Purchasing", "submit for review");
    if (r) b.push(r);
    if (!offset.signedFile) b.push("Attach the signed minutes file");
    if (offset.signedAmountRaw.trim() === "") b.push("Type the amount shown on the signed minutes");
    else {
      const p = parseAmountInput(offset.signedAmountRaw);
      if (!p.ok) b.push(`Amount on signed minutes: ${p.error}`);
      else if (p.value.value !== offset.amount)
        b.push(
          `Amount on signed minutes (${fmtMoney(p.value.value, c, rules)}) does not match the offset amount (${fmtMoney(offset.amount, c, rules)})`,
        );
    }
    actions.push({ id: "submit", label: "Submit for review", blockers: b, needsReason: false, tone: "primary" });
  }
  if (s === "Pending review") {
    const base = approvalBlockers(data, rules, session, offset);
    const two = needsSecondApprover(rules, offset);
    const threshold = rules.secondApproverAbove ?? 0;
    if (two && offset.approvals.length === 0) {
      actions.push({ id: "approve", label: "Approve (1 of 2)", blockers: base, needsReason: false, tone: "secondary" });
    }
    const postB = [...base];
    if (two) {
      if (offset.approvals.length === 0) {
        postB.push(`Above ${fmtMoney(threshold, c, rules)} a second approver is required — no approval given yet`);
      } else if (offset.approvals.some((a) => a.by === session.userName)) {
        postB.push(`${session.userName} gave the first approval — a different approver must post`);
      }
    }
    actions.push({
      id: "approve-post",
      label: two && offset.approvals.length > 0 ? "Approve (2 of 2) and post" : "Approve and post",
      blockers: postB,
      needsReason: false,
      tone: "primary",
    });
    const rb: string[] = [];
    const rr = roleBlock(session, "Accounting", "return to draft");
    if (rr) rb.push(rr);
    actions.push({ id: "return", label: "Return to draft", blockers: rb, needsReason: true, tone: "secondary" });
  }
  if (isActiveStatus(s)) {
    const cb: string[] = [];
    if (session.role !== "Purchasing" && session.role !== "Accounting") cb.push("Only Purchasing or Accounting can cancel");
    actions.push({ id: "cancel", label: "Cancel offset", blockers: cb, needsReason: false, tone: "danger" });
  }
  if (s === "Posted") {
    const b: string[] = [];
    const r = roleBlock(session, "Accounting", "reverse");
    if (r) b.push(r);
    const period = monthOf(data.asOfDate);
    if (rules.closedPeriods.includes(period)) b.push(`Period ${period} is closed`);
    actions.push({ id: "reverse", label: "Reverse", blockers: b, needsReason: true, tone: "danger" });
  }
  return actions;
}

export function runOffsetAction(
  data: Dataset,
  rules: Rules,
  session: Session,
  offsetId: string,
  actionId: ActionId,
  payload: { reason?: string | undefined } = {},
): Result<Dataset> {
  const offset = findOffset(data, offsetId);
  if (!offset) return fail(`Offset ${offsetId} not found`);
  const action = offsetActions(data, rules, session, offset).find((a) => a.id === actionId);
  if (!action) return fail(`Action not available in ${offset.status}`);
  if (action.blockers.length) return fail(action.blockers[0] ?? "Action unavailable");
  const reason = payload.reason?.trim() ?? "";
  if (action.needsReason && !reason) return fail("A reason is required");
  const po = findPo(data, offset.sourcePoId);
  const c = po?.currency ?? "";

  switch (actionId) {
    case "edit":
      return fail("Use the edit panel");
    case "generate-minutes": {
      const fig = computeOffsetFigures(data, rules, {
        sourcePoId: offset.sourcePoId,
        targetBillId: offset.targetBillId,
        amount: offset.amount,
        offset,
      });
      if (!fig.ok) return fig;
      const previous = offset.voidedMinutes.find((m) => /^BBCTCN-\d{4}-\d{2}-\d{3,}/.test(m.number));
      const base = previous?.number.replace(/^(BBCTCN-\d{4}-\d{2}-\d{3,})(?:-\d+)?$/, "$1") ?? nextDocumentNumber(data, "BBCTCN");
      const n = offset.voidedMinutes.filter((m) => m.number === base || m.number.startsWith(`${base}-`)).length + 1;
      let next: Offset = {
        ...offset,
        status: "Awaiting signature",
        minutes: {
          number: `${base}${n > 1 ? `-${n}` : ""}`,
          generatedAt: stamp(data),
          generatedBy: session.userName,
          amount: offset.amount,
          figures: fig.value,
          voided: false,
        },
      };
      next = log(next, data, session, "Generated minutes — amounts locked", next.minutes?.number);
      return ok(replace(data, next));
    }
    case "submit": {
      const next = log({ ...offset, status: "Pending review" }, data, session, "Submitted for review", offset.signedFile?.name);
      return ok(replace(data, next));
    }
    case "approve": {
      const next = log(
        { ...offset, approvals: [...offset.approvals, { by: session.userName, at: stamp(data) }] },
        data,
        session,
        "Approved (1 of 2)",
      );
      return ok(replace(data, next));
    }
    case "approve-post": {
      const fig = computeOffsetFigures(data, rules, {
        sourcePoId: offset.sourcePoId,
        targetBillId: offset.targetBillId,
        amount: offset.amount,
        offset,
      });
      if (!fig.ok) return fig;
      const at = stamp(data);
      const journalId = nextDocumentNumber(data, "JE");
      const next = log(
        {
          ...offset,
          status: "Posted",
          approvals: [...offset.approvals, { by: session.userName, at }],
          frozen: fig.value,
          postedAt: at,
          postedBy: session.userName,
          postingDate: data.asOfDate,
          journalId,
        },
        data,
        session,
        "Approved and posted — numbers frozen",
        `${journalId} · FX ${fmtMoney(fig.value.fx, fig.value.bookCurrency, rules)}`,
      );
      return ok(replace(data, next));
    }
    case "return": {
      const next = log({ ...voidMinutes(offset), status: "Draft" }, data, session, "Returned to draft — minutes voided", reason);
      return ok(replace(data, next));
    }
    case "cancel": {
      const next = log({ ...offset, status: "Cancelled" }, data, session, "Cancelled", reason || undefined);
      return ok(replace(data, next));
    }
    case "reverse": {
      if (!offset.frozen) return fail("Original journal is missing");
      const journalId = nextDocumentNumber(data, "JE");
      const journal = offset.frozen.journal.map((line) => ({ ...line, debit: line.credit, credit: line.debit }));
      const next = log(
        { ...offset, status: "Reversed", reversal: { reason, by: session.userName, at: stamp(data), journalId, journal } },
        data,
        session,
        "Reversed",
        `${journalId} · ${reason} (${fmtMoney(offset.amount, c, rules)} credit returned to ${offset.sourcePoId})`,
      );
      return ok(replace(data, next));
    }
  }
}
