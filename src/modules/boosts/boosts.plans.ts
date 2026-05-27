import type { BoostPlan } from "@prisma/client";

export type BoostPlanDef = {
  id: BoostPlan;
  label: string;
  months: number;
  priceNaira: number;
};

export const BOOST_PLANS: readonly BoostPlanDef[] = [
  { id: "monthly", label: "1 month", months: 1, priceNaira: 5_000 },
  { id: "quarterly", label: "3 months", months: 3, priceNaira: 12_000 },
  { id: "biannual", label: "6 months", months: 6, priceNaira: 20_000 },
];

export function getPlan(id: string): BoostPlanDef | undefined {
  return BOOST_PLANS.find((p) => p.id === id);
}

export function planEndDate(start: Date, plan: BoostPlanDef): Date {
  return new Date(start.getTime() + plan.months * 30 * 24 * 60 * 60 * 1000);
}
