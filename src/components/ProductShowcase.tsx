import Link from "next/link";
import { ProductPhoto } from "@/components/ProductPhoto";
import type { Product } from "@/lib/categories";

export function ProductShowcase({
  products,
  categoryName,
}: {
  products: Product[];
  categoryName: string;
}) {
  if (products.length === 0) return null;

  return (
    <section className="border-t border-ink/10 px-6 py-20 sm:px-10">
      <div className="mb-12 flex items-baseline justify-between">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          The first drop
        </h2>
        <p className="font-mono text-xs tracking-[0.15em] text-ink-soft uppercase">
          {String(products.length).padStart(2, "0")} pieces — {categoryName}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        {products.map((product) => (
          <Link
            key={product.slug}
            href={`/products/${product.slug}`}
            style={{ aspectRatio: product.imageAspect ?? "33/65" }}
            className="group relative block overflow-hidden rounded-2xl bg-stone"
          >
            {product.images && product.images.length > 0 ? (
              <ProductPhoto images={product.images} alt={product.name} />
            ) : (
              <div className="m-3 flex h-[calc(100%-1.5rem)] items-center justify-center rounded-xl border border-dashed border-ink/15">
                <span className="px-3 text-center font-mono text-[11px] tracking-[0.08em] text-ink-soft/70 uppercase">
                  Coming soon
                </span>
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-ink/70 via-ink/0 to-transparent p-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span className="font-mono text-xs tracking-[0.08em] text-paper uppercase">
                {product.name}
              </span>
              <span className="font-mono text-xs text-paper/80">→</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
