import { NozzleLink } from "@/components/NozzleLink";
import { ProductPhoto } from "@/components/ProductPhoto";
import type { Product } from "@/lib/categories";

function RegMark({ className }: { className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute h-4 w-4 ${className}`}>
      <span className="absolute inset-0 m-auto h-4 w-px bg-ink/30" />
      <span className="absolute inset-0 m-auto h-px w-4 bg-ink/30" />
    </span>
  );
}

const CALLOUT_POSITION = [
  "md:top-[16%] md:-left-1 md:-translate-x-full md:flex-row-reverse md:text-right",
  "md:top-1/2 md:-translate-y-1/2 md:-right-1 md:translate-x-full",
  "md:bottom-[10%] md:-left-1 md:-translate-x-full md:flex-row-reverse md:text-right",
];

function Callout({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <div
      className={`flex items-center gap-2 border-t border-dashed border-ink/15 py-2.5 last:border-b md:absolute md:border-0 md:py-0 ${CALLOUT_POSITION[index]}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
      <span className="hidden h-px w-11 shrink-0 bg-ink/30 md:block" />
      <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.08em] text-ink uppercase">
        {label}: {value}
      </span>
    </div>
  );
}

export function ProductShowcase({
  products,
  categoryName,
}: {
  products: Product[];
  categoryName: string;
}) {
  if (products.length === 0) return null;

  const idPrefix = categoryName.slice(0, 2).toUpperCase();

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

      <div className="flex flex-col gap-12">
        {products.map((product, i) => (
          <article
            key={product.name}
            className="relative mx-auto w-full max-w-2xl border border-ink/25 bg-paper p-6 sm:p-9"
          >
            <RegMark className="-top-2 -left-2" />
            <RegMark className="-top-2 -right-2" />
            <RegMark className="-bottom-2 -left-2" />
            <RegMark className="-bottom-2 -right-2" />

            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-3xl text-ink">{product.name}</h3>
              <span className="font-mono text-xs whitespace-nowrap text-ink-soft/60">
                NBT—{idPrefix}—{String(i + 1).padStart(2, "0")}
              </span>
            </div>

            <div className="relative mt-6 border border-ink/20">
              {product.images && product.images.length > 0 ? (
                <ProductPhoto images={product.images} alt={product.name} />
              ) : (
                <div className="flex min-h-72 items-center justify-center border border-dashed border-ink/20 sm:min-h-96">
                  <span className="font-mono text-xs tracking-[0.1em] text-ink-soft/60 uppercase">
                    Product photo — coming soon
                  </span>
                </div>
              )}

              {product.specs.map((spec, si) => (
                <Callout key={spec.label} label={spec.label} value={spec.value} index={si} />
              ))}
            </div>

            <p className="mt-6 max-w-md text-sm leading-relaxed text-ink-soft">
              {product.description}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-dashed border-ink/25 pt-4 font-mono text-[11px] tracking-[0.03em] text-ink-soft uppercase">
              <span>Status: Pre-launch</span>
              <span>Price: {product.priceSar ? `SAR ${product.priceSar}` : "Pending"}</span>
              <span>Origin: Saudi Arabia</span>
            </div>

            <NozzleLink
              href="/#waitlist"
              cornerRadius={2}
              className="mt-6 inline-flex items-center justify-center rounded-sm border border-ink px-6 py-3 font-mono text-xs tracking-[0.12em] text-ink uppercase transition-colors hover:bg-ink hover:text-paper"
            >
              Notify me
            </NozzleLink>
          </article>
        ))}
      </div>
    </section>
  );
}
