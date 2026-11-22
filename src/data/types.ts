export type Currency = string;
export type Role = "Purchasing" | "Accounting" | "Finance" | "Account manager";
export const ROLES: Role[] = ["Purchasing", "Accounting", "Finance", "Account manager"];

export interface Entity {
  id: string;
  name: string;
  bookCurrency: Currency;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface User {
  id: string;
  name: string;
  defaultRole: Role;
  title?: string;
}

export type PoStatus = "Open" | "Received" | "Closed short";
export const PO_STATUSES: PoStatus[] = ["Open", "Received", "Closed short"];

export interface PurchaseOrder {
  id: string;
  entityId: string;
  supplierId: string;
  currency: Currency;
  qtyOrdered: number;
  unitPrice: number;
  qtyReceived: number;
  status: PoStatus;
}

export type PaymentType = "Advance" | "Payment";
export const PAYMENT_TYPES: PaymentType[] = ["Advance", "Payment"];

export interface Payment {
  id: string;
  poId: string;
  date: string;
  type: PaymentType;
  amount: number;
}

export interface Bill {
  id: string;
  poId: string;
  date: string;
  amount: number;
  settledFromAdvance: number;
  paidInCash: number;
  dueDate: string;
  /** Amount of this bill already scheduled in a payment run (transaction currency). */
  inPaymentRun: number;
}

export interface Shipment {
  id: string;
  poId: string;
  soId: string;
  qty: number;
  blIssued: boolean;
}

export interface SalesOrder {
  id: string;
  entityId: string;
  buyer: string;
  currency: Currency;
  qty: number;
  unitPrice: number;
}

/** Book-currency units per 1 unit of `currency`, on `date`. */
export interface FxRate {
  currency: Currency;
  bookCurrency: Currency;
  date: string;
  rate: number;
}

export type OffsetStatus =
  | "Draft"
  | "Awaiting signature"
  | "Pending review"
  | "Posted"
  | "Cancelled"
  | "Reversed";

export type AttributionBasis = "SOURCE_PO" | "BOTH_POS";
export type AdvanceRateMethod = "FIFO" | "WEIGHTED_AVERAGE";

export interface AdvanceSlice {
  paymentId: string;
  date: string;
  amount: number;
  rate: number;
  book: number;
}

export interface JournalLine {
  account: string;
  description: string;
  debit: number;
  credit: number;
}

export interface OffsetFigures {
  amount: number;
  currency: Currency;
  bookCurrency: Currency;
  method: AdvanceRateMethod;
  advanceSlices: AdvanceSlice[];
  advanceSide: number;
  avgRate: number | null;
  billDate: string;
  billRate: number;
  billSide: number;
  fx: number;
  journal: JournalLine[];
  totalDebit: number;
  totalCredit: number;
}

export interface HistoryEntry {
  at: string;
  by: string;
  role: Role;
  action: string;
  note?: string | undefined;
}

export interface OffsetMinutes {
  number: string;
  generatedAt: string;
  generatedBy: string;
  amount: number;
  figures: OffsetFigures;
  /** Absent on older saved minutes; never reconstruct historical balances from live data. */
  balances?: {
    sourcePoCredit: number;
    targetBillOpen: number;
    offsetAmount: number;
    targetBillAfter: number;
    currency: Currency;
    decimals: number;
  };
  voided: boolean;
}

export interface AttributionBasisRow {
  soId: string;
  qty: number;
}

export interface Offset {
  id: string;
  sourcePoId: string;
  targetBillId: string;
  amount: number;
  status: OffsetStatus;
  createdBy: string;
  createdAt: string;
  minutes: OffsetMinutes | null;
  voidedMinutes: OffsetMinutes[];
  signedFile: { name: string; size: number; uploadedAt: string; uploadedBy: string } | null;
  signedAmountRaw: string;
  approvals: { by: string; at: string }[];
  frozen: OffsetFigures | null;
  postedAt: string | null;
  postedBy: string | null;
  postingDate: string | null;
  journalId?: string;
  reversal: { reason: string; by: string; at: string; journalId?: string; journal?: JournalLine[] } | null;
  frozenAttribution: Partial<Record<AttributionBasis, AttributionBasisRow[]>>;
  history: HistoryEntry[];
}

export interface Dataset {
  /** "Today" for the demo. */
  asOfDate: string;
  entities: Entity[];
  suppliers: Supplier[];
  users: User[];
  purchaseOrders: PurchaseOrder[];
  payments: Payment[];
  bills: Bill[];
  shipments: Shipment[];
  salesOrders: SalesOrder[];
  fxRates: FxRate[];
  offsets: Offset[];
}
