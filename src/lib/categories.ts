export type ProductSpec = {
  label: string;
  value: string;
};

export type Product = {
  name: string;
  description: string;
  specs: ProductSpec[];
};

export type Category = {
  slug: string;
  name: string;
  nameArabic: string;
  eyebrow: string;
  headline: string[];
  description: string;
  products: Product[];
  live: boolean;
};

export const categories: Category[] = [
  {
    slug: "",
    name: "Planters",
    nameArabic: "أواني الزرع",
    eyebrow: "Printed in Saudi Arabia",
    headline: ["Vessels,", "drawn in", "a single line."],
    description:
      "Nabtah planters are printed, not molded — one continuous wall, traced from base to rim, then finished by hand. The first collection is almost ready.",
    products: [
      {
        name: "Qamra",
        description: "A squat, wide-mouthed planter for trailing plants and low succulents.",
        specs: [
          { label: "Height", value: "11 cm" },
          { label: "Print time", value: "4h 20m" },
          { label: "Wall", value: "Single line" },
        ],
      },
      {
        name: "Rukn",
        description: "A tall corner planter, tapered to sit flush against a wall or ledge.",
        specs: [
          { label: "Height", value: "26 cm" },
          { label: "Print time", value: "7h 10m" },
          { label: "Wall", value: "Single line" },
        ],
      },
      {
        name: "Sadaf",
        description: "A ribbed, shell-like profile for a single statement plant.",
        specs: [
          { label: "Height", value: "18 cm" },
          { label: "Print time", value: "5h 45m" },
          { label: "Wall", value: "Single line" },
        ],
      },
    ],
    live: true,
  },
  {
    slug: "kitchen",
    name: "Kitchen",
    nameArabic: "المطبخ",
    eyebrow: "Next collection",
    headline: ["Made for", "counters,", "not shelves."],
    description:
      "The kitchen collection is next on the print bed — utensil holders, spice trays, and countertop organizers, printed the same way as the first collection.",
    products: [],
    live: false,
  },
];

export function getCategoryBySlug(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}

export function getNextCategory(currentSlug: string): Category {
  const index = categories.findIndex((c) => c.slug === currentSlug);
  return categories[(index + 1) % categories.length];
}
