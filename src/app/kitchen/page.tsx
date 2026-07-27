import { Nav } from "@/components/Nav";
import { CategoryArrow } from "@/components/CategoryArrow";
import { Footer } from "@/components/Footer";
import { categories, getCategoryBySlug, getNextCategory } from "@/lib/categories";

export default function KitchenPage() {
  const category = getCategoryBySlug("kitchen")!;
  const previous = categories[0];
  const next = getNextCategory(category.slug);

  return (
    <div className="flex flex-1 flex-col">
      <Nav />
      <CategoryArrow target={previous} direction="back" />
      <CategoryArrow target={next} />

      <section className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center sm:px-10">
        <p className="font-sans text-sm text-ink-soft">{category.eyebrow}</p>
        <h1 className="font-display text-5xl font-bold leading-[1.05] text-ink sm:text-6xl">
          {category.headline.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="max-w-md font-sans text-lg leading-relaxed text-ink-soft">
          {category.description}
        </p>
      </section>

      <Footer />
    </div>
  );
}
