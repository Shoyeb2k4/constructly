/** Default labour categories seeded for new companies (editable). Colors are
 *  data-accent hexes that read well in both light and dark themes. */
export const DEFAULT_CATEGORIES: { name: string; color: string; dailyRateRupees: number }[] = [
  { name: "Helper", color: "#F59E0B", dailyRateRupees: 550 },
  { name: "Mason", color: "#3B82F6", dailyRateRupees: 850 },
  { name: "Carpenter", color: "#8B5CF6", dailyRateRupees: 900 },
  { name: "Electrician", color: "#10B981", dailyRateRupees: 1100 },
  { name: "Plumber", color: "#06B6D4", dailyRateRupees: 950 },
  { name: "Painter", color: "#F43F5E", dailyRateRupees: 700 },
  { name: "Steel Fixer", color: "#F97316", dailyRateRupees: 800 },
  { name: "Supervisor", color: "#64748B", dailyRateRupees: 1500 },
];

export const CATEGORY_COLORS = [
  "#F59E0B", "#3B82F6", "#8B5CF6", "#10B981", "#06B6D4",
  "#F43F5E", "#F97316", "#64748B", "#EC4899", "#84CC16",
];
