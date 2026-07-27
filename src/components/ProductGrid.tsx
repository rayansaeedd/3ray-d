import type { Product } from "@/lib/categories";

export function ProductGrid({
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

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-ink/10 sm:grid-cols-3">
        {products.map((product, i) => (
          <article key={product.name} className="flex flex-col gap-5 bg-paper p-7">
            <div className="flex items-start justify-between">
              <h3 className="font-display text-2xl text-ink">{product.name}</h3>
              <span className="font-mono text-xs text-ink-soft/70">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <p className="flex-1 font-sans text-sm leading-relaxed text-ink-soft">
              {product.description}
            </p>
            <dl className="grid grid-cols-3 gap-2 border-t border-ink/10 pt-4">
              {product.specs.map((spec) => (
                <div key={spec.label}>
                  <dt className="font-mono text-[10px] tracking-[0.1em] text-ink-soft/70 uppercase">
                    {spec.label}
                  </dt>
                  <dd className="font-mono text-xs text-ink">{spec.value}</dd>
                </div>
              ))}
            </dl>
            <span className="w-fit rounded-full bg-sage/15 px-3 py-1 font-mono text-[10px] tracking-[0.1em] text-sage uppercase">
              Coming soon
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
