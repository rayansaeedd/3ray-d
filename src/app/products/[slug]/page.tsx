import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { NozzleLink } from "@/components/NozzleLink";
import { ProductGallery } from "@/components/ProductGallery";
import { getAllProducts, getProductBySlug } from "@/lib/categories";

export function generateStaticParams() {
  return getAllProducts().map(({ product }) => ({ slug: product.slug }));
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = getProductBySlug(slug);
  if (!entry) notFound();
  const { product, category } = entry;

  return (
    <div className="flex flex-1 flex-col">
      <Nav />

      <main className="mx-auto w-full max-w-5xl px-6 pt-28 pb-24 sm:px-10 sm:pt-32">
        <Link
          href={category.slug ? `/${category.slug}` : "/"}
          className="font-mono text-xs tracking-[0.1em] text-ink-soft uppercase transition-colors hover:text-ink"
        >
          ← Back to {category.name}
        </Link>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          <ProductGallery images={product.images ?? []} alt={product.name} />

          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">
                {product.name}
              </h1>
              <p className="mt-4 max-w-md text-base leading-relaxed text-ink-soft">
                {product.description}
              </p>
            </div>

            <p className="font-mono text-lg text-ink">
              {product.priceSar ? (
                <>
                  <span className="mr-1 text-xs text-ink-soft">SAR</span>
                  {product.priceSar}
                </>
              ) : (
                <span className="font-mono text-sm text-ink-soft uppercase">
                  Price — coming soon
                </span>
              )}
            </p>

            <dl className="grid grid-cols-3 gap-4 border-t border-b border-ink/10 py-5">
              {product.specs.map((spec) => (
                <div key={spec.label}>
                  <dt className="font-mono text-[10px] tracking-[0.08em] text-ink-soft/70 uppercase">
                    {spec.label}
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-ink">{spec.value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="font-mono text-xs tracking-[0.1em] text-ink-soft uppercase">
                Colors
              </p>
              <div className="mt-3 flex items-center gap-2">
                {product.colors.map((color) => (
                  <span
                    key={color}
                    style={{ backgroundColor: color }}
                    className="h-8 w-8 rounded-full border border-ink/15"
                    aria-hidden
                  />
                ))}
                <span className="rounded-full border border-ink/20 px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] text-ink-soft uppercase">
                  + Custom
                </span>
              </div>
            </div>

            <NozzleLink
              href="/#waitlist"
              className="mt-2 w-full rounded-full bg-ink py-4 text-center font-sans text-sm font-medium text-paper transition-colors hover:bg-teal-deep sm:w-fit sm:px-10"
            >
              Notify me
            </NozzleLink>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
