import type { AdvanceRateMethod, AttributionBasis } from "@/data/types";

export interface Rules {
  advanceRateMethod: AdvanceRateMethod;
  requireSourcePoClosed: boolean;
  attributionBasis: AttributionBasis;
  allowSelfApproval: boolean;
  /** Offsets above this amount (transaction currency) need a second approver. null = never. */
  secondApproverAbove: number | null;
  /** Closed months, "YYYY-MM". */
  closedPeriods: string[];
  /** Currencies rounded to 0 decimals; all others round to 2. */
  zeroDecimalCurrencies: string[];
}

export const defaultRules: Rules = {
  advanceRateMethod: "FIFO",
  requireSourcePoClosed: true,
  attributionBasis: "SOURCE_PO",
  allowSelfApproval: false,
  secondApproverAbove: null,
  closedPeriods: [],
  zeroDecimalCurrencies: ["VND"],
};

export const ruleLabels: Record<keyof Rules, { label: string; help: string }> = {
  advanceRateMethod: {
    label: "Advance rate method",
    help: "How the advance side is valued: FIFO slices at each payment's rate, or the weighted average of all advances.",
  },
  requireSourcePoClosed: {
    label: "Source PO must be closed",
    help: "Block offsets from a PO that is still Open.",
  },
  attributionBasis: {
    label: "SO attribution basis",
    help: "Tonnes used to attribute credit to sales orders: the source PO only, or both POs.",
  },
  allowSelfApproval: {
    label: "Allow self-approval",
    help: "Let the creator of an offset also approve it.",
  },
  secondApproverAbove: {
    label: "Second approver above",
    help: "Offsets above this amount (transaction currency) need two different approvers. Empty = never.",
  },
  closedPeriods: {
    label: "Closed periods",
    help: "Months where nothing can be posted or reversed.",
  },
  zeroDecimalCurrencies: {
    label: "Zero-decimal currencies",
    help: "Currencies rounded to whole units.",
  },
};

export function cloneDefaultRules(): Rules {
  return structuredClone(defaultRules);
}
