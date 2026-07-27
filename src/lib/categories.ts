export type ProductSpec = {
  label: string;
  value: string;
};

export type Product = {
  slug: string;
  name: string;
  description: string;
  specs: ProductSpec[];
  priceSar?: number;
  colors: string[];
  images?: string[];
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
        slug: "qamra",
        name: "Qamra",
        description:
          "A modular wall planter — individual pots that clip onto a shared rod, so you can mix succulents and trailing plants in one arrangement.",
        specs: [
          { label: "Pots", value: "5" },
          { label: "Mount", value: "Wall rod" },
          { label: "Wall", value: "Single line" },
        ],
        colors: ["#f3ede0", "#8a9787", "#1f3214"],
        images: ["/products/qamra-1.jpg", "/products/qamra-2.jpg"],
      },
      {
        slug: "rukn",
        name: "Rukn",
        description: "A tall corner planter, tapered to sit flush against a wall or ledge.",
        specs: [
          { label: "Height", value: "26 cm" },
          { label: "Width", value: "13 cm" },
          { label: "Print time", value: "7h 10m" },
        ],
        colors: ["#f3ede0", "#8a9787", "#1f3214"],
      },
      {
        slug: "sadaf",
        name: "Sadaf",
        description: "A ribbed, shell-like profile for a single statement plant.",
        specs: [
          { label: "Height", value: "18 cm" },
          { label: "Width", value: "16 cm" },
          { label: "Print time", value: "5h 45m" },
        ],
        colors: ["#f3ede0", "#8a9787", "#1f3214"],
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

export function getAllProducts(): { product: Product; category: Category }[] {
  return categories.flatMap((category) =>
    category.products.map((product) => ({ product, category }))
  );
}

export function getProductBySlug(
  slug: string
): { product: Product; category: Category } | undefined {
  return getAllProducts().find((entry) => entry.product.slug === slug);
}
