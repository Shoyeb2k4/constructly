/** Default labour hierarchy seeded for new companies (fully editable —
 *  unlimited categories and subcategories). */
export const DEFAULT_HIERARCHY: {
  name: string;
  color: string;
  subcategories: { name: string; dailyRateRupees: number }[];
}[] = [
  {
    name: "Carpenter",
    color: "#8B5CF6",
    subcategories: [
      { name: "Main Carpenter", dailyRateRupees: 900 },
      { name: "Carpenter Helper", dailyRateRupees: 550 },
    ],
  },
  {
    name: "Electrician",
    color: "#10B981",
    subcategories: [
      { name: "Main Electrician", dailyRateRupees: 1100 },
      { name: "Electrician Helper", dailyRateRupees: 600 },
    ],
  },
  {
    name: "Mason",
    color: "#3B82F6",
    subcategories: [
      { name: "Mason", dailyRateRupees: 850 },
      { name: "Mason Helper", dailyRateRupees: 550 },
    ],
  },
  {
    name: "Painter",
    color: "#F43F5E",
    subcategories: [
      { name: "Painter", dailyRateRupees: 700 },
      { name: "Painter Helper", dailyRateRupees: 450 },
    ],
  },
  {
    name: "Plumbing",
    color: "#06B6D4",
    subcategories: [
      { name: "Main Plumber", dailyRateRupees: 950 },
      { name: "Plumber Helper", dailyRateRupees: 550 },
    ],
  },
];

export const CATEGORY_COLORS = [
  "#F59E0B", "#3B82F6", "#8B5CF6", "#10B981", "#06B6D4",
  "#F43F5E", "#F97316", "#64748B", "#EC4899", "#84CC16",
];

export const FALLBACK_COLOR = "#64748B";
