import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { CategoryArrow } from "@/components/CategoryArrow";
import { ProductShowcase } from "@/components/ProductShowcase";
import { PaymentBand } from "@/components/PaymentBand";
import { Footer } from "@/components/Footer";
import { categories, getNextCategory } from "@/lib/categories";

export default function Home() {
  const category = categories[0];
  const next = getNextCategory(category.slug);

  return (
    <div className="flex flex-1 flex-col">
      <Nav />
      <Hero category={category} />
      <CategoryArrow target={next} />
      <ProductShowcase products={category.products} categoryName={category.name} />
      <PaymentBand />
      <Footer />
    </div>
  );
}
