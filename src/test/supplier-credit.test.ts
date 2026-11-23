import { describe, expect, it } from "vitest";
import { cloneSeed } from "@/data/seed";
import { cloneDefaultRules } from "@/config/rules";
import type { Dataset } from "@/data/types";
import { comparableVndValue, supplierCreditRanking, supplierCreditVndTotal } from "@/lib/offsetCalc";

const rules = cloneDefaultRules();

function row(data: Dataset, supplier: string, bookCurrency: string) {
  const r = supplierCreditRanking(data, rules).find(
    (x) => x.supplier.name === supplier && x.bookCurrency === bookCurrency,
  );
  if (!r) throw new Error(`Missing row ${supplier} / ${bookCurrency}`);
  return r;
}

describe("supplier credit comparable value in VND", () => {
  it("keeps a VND book value as-is and converts a USD book value at the latest USD/VND rate", () => {
    const data = cloneSeed();
    const vnd = row(data, "Sengdao Coffee", "VND");
    const usd = row(data, "Mekong Pepper JSC", "USD");
    expect(vnd.historical).toBe(121_248_000);
    expect(vnd.comparableVnd).toBe(121_248_000);
    expect(usd.historical).toBe(3000);
    expect(usd.comparableVnd).toBe(76_200_000); // 3,000 × 25,400 (latest USD/VND rate on 2026-11-18)
  });

  it("sorts rows by comparable VND value, highest first", () => {
    const rows = supplierCreditRanking(cloneSeed(), rules);
    expect(rows.map((r) => r.comparableVnd)).toEqual([329_950_000, 121_248_000, 76_200_000, 50_000_000]);
    expect(rows.map((r) => `${r.supplier.name}/${r.bookCurrency}`)).toEqual([
      "Dak Lak Green Bean Co./VND",
      "Sengdao Coffee/VND",
      "Mekong Pepper JSC/USD",
      "Mekong Pepper JSC/VND",
    ]);
  });

  it("totals the comparable values in VND", () => {
    const rows = supplierCreditRanking(cloneSeed(), rules);
    expect(supplierCreditVndTotal(rows, rules)).toBe(577_398_000);
  });

  it("revalues the USD row at the latest USD/VND rate", () => {
    const data = cloneSeed();
    expect(row(data, "Mekong Pepper JSC", "USD").comparableVnd).toBe(76_200_000);
    data.fxRates = data.fxRates.map((r) => (r.date === "2026-11-17" ? { ...r, rate: 26000 } : r));
    const rows = supplierCreditRanking(data, rules);
    expect(row(data, "Mekong Pepper JSC", "USD").comparableVnd).toBe(78_000_000);
    expect(supplierCreditVndTotal(rows, rules)).toBe(
      rows.reduce((a, r) => a + (r.comparableVnd ?? 0), 0),
    );
  });

  it("gives no comparable value to a book currency without a USD/VND route and excludes it from the total", () => {
    const data = cloneSeed();
    data.entities.push({ id: "ENT-C", name: "Company C", bookCurrency: "EUR" });
    data.purchaseOrders.push({
      id: "PO-401", entityId: "ENT-C", supplierId: "SUP-1", currency: "EUR",
      qtyOrdered: 1, qtyReceived: 0, unitPrice: 1000, status: "Received",
    });
    data.payments.push({ id: "PAY-401", poId: "PO-401", date: "2026-11-17", type: "Advance", amount: 1000 });
    const rows = supplierCreditRanking(data, rules);
    expect(rows.at(-1)?.bookCurrency).toBe("EUR");
    expect(rows.at(-1)?.comparableVnd).toBeNull();
    expect(supplierCreditVndTotal(rows, rules)).toBe(577_398_000);
  });

  it("sorts a USD row with no rate last and keeps it out of the total", () => {
    const data = cloneSeed();
    data.fxRates = data.fxRates.filter((r) => r.bookCurrency !== "VND");
    const rows = supplierCreditRanking(data, rules);
    expect(rows.at(-1)?.bookCurrency).toBe("USD");
    expect(rows.at(-1)?.comparableVnd).toBeNull();
    // only the VND-book PO-303 credit survives without a USD/VND rate
    expect(supplierCreditVndTotal(rows, rules)).toBe(50_000_000);
  });

  it("rounds the converted value to whole VND", () => {
    expect(comparableVndValue(cloneSeed(), rules, "USD", 0.01)).toBe(254);
  });
});
