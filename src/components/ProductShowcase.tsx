import { NozzleLink } from "@/components/NozzleLink";
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
        <h2 className="font-display text-3xl text-ink sm:text-4xl">
          The first drop
        </h2>
        <p className="font-mono text-xs tracking-[0.15em] text-ink-soft uppercase">
          {String(products.length).padStart(2, "0")} pieces — {categoryName}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <article
            key={product.name}
            className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-paper"
          >
            <div className="relative aspect-[33/65] w-full bg-stone">
              {product.images && product.images.length > 0 ? (
                <ProductPhoto images={product.images} alt={product.name} />
              ) : (
                <div className="m-3 flex h-[calc(100%-1.5rem)] items-center justify-center rounded-xl border border-dashed border-ink/15">
                  <span className="px-4 text-center font-mono text-xs tracking-[0.1em] text-ink-soft/70 uppercase">
                    Product photo — coming soon
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-4 p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-2xl text-ink">{product.name}</h3>
                <span className="font-mono text-xs whitespace-nowrap text-ink-soft">
                  {product.priceSar ? `SAR ${product.priceSar}` : "SAR — soon"}
                </span>
              </div>

              <p className="text-sm leading-relaxed text-ink-soft">
                {product.description}
              </p>

              <dl className="grid grid-cols-3 gap-2 border-t border-b border-ink/10 py-4">
                {product.specs.map((spec) => (
                  <div key={spec.label}>
                    <dt className="font-mono text-[10px] tracking-[0.08em] text-ink-soft/60 uppercase">
                      {spec.label}
                    </dt>
                    <dd className="font-mono text-xs text-ink">{spec.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex items-center gap-2">
                {product.colors.map((color) => (
                  <span
                    key={color}
                    style={{ backgroundColor: color }}
                    className="h-6 w-6 rounded-full border border-ink/15"
                    aria-hidden
                  />
                ))}
                <span className="rounded-full border border-ink/20 px-3 py-1 font-mono text-[10px] tracking-[0.06em] text-ink-soft uppercase">
                  + Custom
                </span>
              </div>

              <NozzleLink
                href="/#waitlist"
                className="mt-auto w-full rounded-full bg-teal py-3 text-center font-mono text-xs tracking-[0.12em] text-paper uppercase transition-colors hover:bg-teal-deep"
              >
                Notify me
              </NozzleLink>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
