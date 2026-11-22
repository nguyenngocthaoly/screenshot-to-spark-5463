import type { Dataset } from "./types";

/** The demo dataset. All app state starts here; "Reset demo" restores it. */
export const seedData: Dataset = {
  asOfDate: "2026-11-18",
  entities: [
    { id: "ENT-A", name: "Company A", bookCurrency: "VND" },
    { id: "ENT-B", name: "Company B", bookCurrency: "USD" },
  ],
  suppliers: [
    { id: "SUP-1", name: "Sengdao Coffee" },
    { id: "SUP-2", name: "Dak Lak Green Bean Co." },
    { id: "SUP-3", name: "Mekong Pepper JSC" },
  ],
  users: [
    { id: "U-1", name: "Linh", title: "Purchasing lead", defaultRole: "Purchasing" },
    { id: "U-2", name: "Huệ", title: "Chief Accountant", defaultRole: "Accounting" },
    { id: "U-3", name: "Thảo", title: "Accountant", defaultRole: "Accounting" },
    { id: "U-4", name: "Mai", title: "Finance Manager", defaultRole: "Finance" },
    { id: "U-5", name: "Tuấn", title: "Account Manager SO-A", defaultRole: "Account manager" },
  ],
  purchaseOrders: [
    { id: "PO-101", entityId: "ENT-A", supplierId: "SUP-1", currency: "USD", qtyOrdered: 5, unitPrice: 4000, qtyReceived: 3.8, status: "Closed short" },
    { id: "PO-102", entityId: "ENT-A", supplierId: "SUP-1", currency: "USD", qtyOrdered: 3, unitPrice: 4000, qtyReceived: 3, status: "Received" },
    { id: "PO-201", entityId: "ENT-A", supplierId: "SUP-2", currency: "USD", qtyOrdered: 10, unitPrice: 3800, qtyReceived: 10, status: "Received" },
    { id: "PO-202", entityId: "ENT-A", supplierId: "SUP-2", currency: "USD", qtyOrdered: 6, unitPrice: 3900, qtyReceived: 2, status: "Open" },
    { id: "PO-301", entityId: "ENT-B", supplierId: "SUP-3", currency: "USD", qtyOrdered: 8, unitPrice: 6200, qtyReceived: 8, status: "Received" },
    { id: "PO-302", entityId: "ENT-B", supplierId: "SUP-3", currency: "USD", qtyOrdered: 4, unitPrice: 6000, qtyReceived: 3.5, status: "Closed short" },
    { id: "PO-303", entityId: "ENT-A", supplierId: "SUP-3", currency: "VND", qtyOrdered: 1, unitPrice: 150000000, qtyReceived: 1, status: "Received" },
  ],
  payments: [
    { id: "PAY-001", poId: "PO-101", date: "2026-09-05", type: "Advance", amount: 12000 },
    { id: "PAY-002", poId: "PO-101", date: "2026-09-20", type: "Advance", amount: 8000 },
    { id: "PAY-201", poId: "PO-201", date: "2026-10-10", type: "Advance", amount: 20000 },
    { id: "PAY-202", poId: "PO-201", date: "2026-11-03", type: "Advance", amount: 10000 },
    { id: "PAY-203", poId: "PO-202", date: "2026-11-17", type: "Advance", amount: 8000 },
    { id: "PAY-301", poId: "PO-301", date: "2026-09-20", type: "Advance", amount: 15000 },
    { id: "PAY-302", poId: "PO-302", date: "2026-10-10", type: "Advance", amount: 10000 },
    { id: "PAY-303", poId: "PO-303", date: "2026-10-28", type: "Advance", amount: 50000000 },
  ],
  bills: [
    { id: "BILL-101", poId: "PO-101", date: "2026-10-10", amount: 15200, settledFromAdvance: 15200, paidInCash: 0, dueDate: "2026-10-10", inPaymentRun: 0 },
    { id: "BILL-102", poId: "PO-102", date: "2026-10-28", amount: 12000, settledFromAdvance: 0, paidInCash: 0, dueDate: "2026-11-27", inPaymentRun: 0 },
    { id: "BILL-201", poId: "PO-201", date: "2026-11-03", amount: 38000, settledFromAdvance: 25000, paidInCash: 0, dueDate: "2026-12-03", inPaymentRun: 0 },
    { id: "BILL-202", poId: "PO-202", date: "2026-11-17", amount: 7800, settledFromAdvance: 0, paidInCash: 0, dueDate: "2026-12-17", inPaymentRun: 3000 },
    { id: "BILL-301", poId: "PO-301", date: "2026-10-28", amount: 49600, settledFromAdvance: 12000, paidInCash: 20000, dueDate: "2026-11-27", inPaymentRun: 0 },
    { id: "BILL-302", poId: "PO-302", date: "2026-11-03", amount: 21000, settledFromAdvance: 10000, paidInCash: 0, dueDate: "2026-12-03", inPaymentRun: 0 },
    { id: "BILL-303", poId: "PO-303", date: "2026-11-17", amount: 150000000, settledFromAdvance: 0, paidInCash: 0, dueDate: "2026-12-17", inPaymentRun: 0 },
  ],
  shipments: [
    { id: "SHP-1", poId: "PO-101", soId: "SO-A", qty: 3, blIssued: true },
    { id: "SHP-2", poId: "PO-101", soId: "SO-B", qty: 0.8, blIssued: true },
    { id: "SHP-3", poId: "PO-102", soId: "SO-A", qty: 1.8, blIssued: true },
    { id: "SHP-4", poId: "PO-102", soId: "SO-B", qty: 1.2, blIssued: true },
    { id: "SHP-5", poId: "PO-201", soId: "SO-C", qty: 10, blIssued: true },
    { id: "SHP-6", poId: "PO-202", soId: "SO-C", qty: 2, blIssued: false },
    { id: "SHP-7", poId: "PO-301", soId: "SO-D", qty: 8, blIssued: true },
    { id: "SHP-8", poId: "PO-302", soId: "SO-D", qty: 3.5, blIssued: true },
  ],
  salesOrders: [
    { id: "SO-A", entityId: "ENT-B", buyer: "Van Dijk Foods BV", currency: "USD", qty: 19.2, unitPrice: 4450 },
    { id: "SO-B", entityId: "ENT-A", buyer: "Minh An Roastery", currency: "VND", qty: 2, unitPrice: 112000000 },
    { id: "SO-C", entityId: "ENT-A", buyer: "Highland Roasters", currency: "VND", qty: 12, unitPrice: 105000000 },
    { id: "SO-D", entityId: "ENT-B", buyer: "Hamburg Spice GmbH", currency: "USD", qty: 11.5, unitPrice: 7100 },
  ],
  fxRates: [
    { currency: "USD", bookCurrency: "VND", date: "2026-09-05", rate: 25200 },
    { currency: "USD", bookCurrency: "VND", date: "2026-09-20", rate: 25260 },
    { currency: "USD", bookCurrency: "VND", date: "2026-10-10", rate: 25300 },
    { currency: "USD", bookCurrency: "VND", date: "2026-10-28", rate: 25330 },
    { currency: "USD", bookCurrency: "VND", date: "2026-11-03", rate: 25350 },
    { currency: "USD", bookCurrency: "VND", date: "2026-11-17", rate: 25400 },
  ],
  offsets: [],
};

export function cloneSeed(): Dataset {
  return structuredClone(seedData);
}
