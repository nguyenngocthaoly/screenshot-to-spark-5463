import { useSyncExternalStore } from "react";
import { cloneDefaultRules, type Rules } from "@/config/rules";
import { cloneSeed } from "@/data/seed";
import type { Dataset, Role } from "@/data/types";
import { reconcileOffsets } from "./offsetCalc";

export interface AppState {
  data: Dataset;
  rules: Rules;
  role: Role;
  userName: string;
  supplierId: string;
  dataPanelOpen: boolean;
}

const STORAGE_KEY = "supplier-debt-offset-demo-v1";

function initialState(): AppState {
  const data = cloneSeed();
  return {
    data,
    rules: cloneDefaultRules(),
    role: "Purchasing",
    userName: defaultUserFor(data, "Purchasing"),
    supplierId: data.suppliers[0]?.id ?? "",
    dataPanelOpen: false,
  };
}

export function defaultUserFor(data: Dataset, role: Role): string {
  return data.users.find((u) => u.defaultRole === role)?.name ?? role;
}

const serverState = initialState();
let state: AppState = serverState;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  if (hydrated && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable */
    }
  }
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}

export function useApp(): AppState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => serverState,
  );
}

/** Load persisted demo state after hydration. */
export function hydrateStore() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      if (parsed.data && parsed.rules) {
        state = { ...state, ...parsed, data: reconcileOffsets(parsed.data), rules: { ...cloneDefaultRules(), ...parsed.rules } };
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  emit();
}

export function updateData(fn: (d: Dataset) => Dataset) {
  setState((s) => ({ data: reconcileOffsets(fn(s.data)) }));
}

export function setData(data: Dataset) {
  setState({ data: reconcileOffsets(data) });
}

export function setRules(rules: Rules) {
  setState({ rules });
}

export function setRole(role: Role) {
  setState((s) => ({ role, userName: defaultUserFor(s.data, role) }));
}

export function resetDemo() {
  const fresh = initialState();
  setState((s) => ({ ...fresh, dataPanelOpen: s.dataPanelOpen }));
}

export function exportJson(s: AppState): string {
  return JSON.stringify({ data: s.data, rules: s.rules }, null, 2);
}

export function importJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { data?: Dataset; rules?: Rules } & Partial<Dataset>;
    const data = (parsed.data ?? (parsed.purchaseOrders ? (parsed as Dataset) : null)) as Dataset | null;
    if (!data) return "JSON must contain a dataset (or { data, rules })";
    const required: (keyof Dataset)[] = ["entities", "suppliers", "purchaseOrders", "payments", "bills", "shipments", "salesOrders", "fxRates"];
    for (const k of required) if (!Array.isArray(data[k])) return `Missing array "${k}"`;
    const seed = cloneSeed();
    const full: Dataset = {
      ...seed,
      ...data,
      users: Array.isArray(data.users) && data.users.length ? data.users : seed.users,
      offsets: Array.isArray(data.offsets) ? data.offsets : [],
      asOfDate: data.asOfDate ?? seed.asOfDate,
    };
    setState((s) => ({
      data: reconcileOffsets(full),
      rules: { ...cloneDefaultRules(), ...(parsed.rules ?? s.rules) },
      supplierId: full.suppliers[0]?.id ?? "",
    }));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid JSON";
  }
}
