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

      <div className="flex flex-col gap-8">
        {products.map((product, i) => (
          <article
            key={product.name}
            className="grid grid-cols-1 overflow-hidden rounded-2xl bg-basalt text-paper md:grid-cols-2"
          >
            {product.images && product.images.length > 0 ? (
              <ProductPhoto images={product.images} alt={product.name} />
            ) : (
              <div className="m-5 flex min-h-72 items-center justify-center rounded-xl border border-dashed border-paper/25 sm:min-h-96">
                <span className="font-mono text-xs tracking-[0.1em] text-paper/45 uppercase">
                  Product photo — coming soon
                </span>
              </div>
            )}

            <div className="flex flex-col gap-6 p-8 sm:p-9">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-3xl">{product.name}</h3>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-sage-pale">
                    {product.description}
                  </p>
                </div>
                <span className="font-mono text-xs text-paper/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>

              <div className="flex items-baseline justify-between">
                {product.priceSar ? (
                  <p className="font-mono text-xl">
                    <span className="mr-1 text-xs text-sage">SAR</span>
                    {product.priceSar}
                  </p>
                ) : (
                  <span className="w-fit rounded-full bg-paper/10 px-3 py-1 font-mono text-[10px] tracking-[0.1em] text-paper/60 uppercase">
                    Price — coming soon
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-3 gap-2 border-t border-b border-paper/15 py-4">
                {product.specs.map((spec) => (
                  <div key={spec.label}>
                    <dt className="font-mono text-[10px] tracking-[0.1em] text-paper/50 uppercase">
                      {spec.label}
                    </dt>
                    <dd className="font-mono text-xs">{spec.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  {product.colors.map((color) => (
                    <span
                      key={color}
                      style={{ backgroundColor: color }}
                      className="h-6 w-6 rounded-full border border-paper/20"
                      aria-hidden
                    />
                  ))}
                  <span className="rounded-full border border-paper/25 px-3 py-1 font-mono text-[10px] tracking-[0.08em] text-paper/80 uppercase">
                    + Custom
                  </span>
                </div>
                <NozzleLink
                  href="/#waitlist"
                  className="rounded-full bg-sage px-6 py-3 font-mono text-xs tracking-[0.12em] text-basalt uppercase transition-opacity hover:opacity-90"
                >
                  Notify me
                </NozzleLink>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
