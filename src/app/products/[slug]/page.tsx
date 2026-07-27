import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { NozzleLink } from "@/components/NozzleLink";
import { ProductGallery } from "@/components/ProductGallery";
import { StickyNotify } from "@/components/StickyNotify";
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

      <main className="mx-auto w-full max-w-5xl px-6 pt-28 pb-28 sm:px-10 sm:pt-32 sm:pb-24">
        <Link
          href={category.slug ? `/${category.slug}` : "/"}
          className="font-mono text-xs tracking-[0.1em] text-ink-soft uppercase transition-colors hover:text-ink"
        >
          ← Back to {category.name}
        </Link>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          <ProductGallery
            images={product.images ?? []}
            alt={product.name}
            aspect={product.imageAspect}
          />

          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">
                {product.name}
              </h1>
              <p className="mt-2 font-sans text-lg text-ink-soft">
                {product.priceSar ? (
                  <>SAR {product.priceSar}</>
                ) : (
                  "Price — coming soon"
                )}
              </p>
            </div>

            <p className="max-w-md text-base leading-relaxed text-ink-soft">
              {product.description}
            </p>

            <dl className="grid grid-cols-3 gap-4 border-t border-ink/10 py-5">
              {product.specs.map((spec) => (
                <div key={spec.label}>
                  <dt className="font-mono text-[10px] tracking-[0.08em] text-ink-soft/70 uppercase">
                    {spec.label}
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-ink">{spec.value}</dd>
                </div>
              ))}
            </dl>

            <div className="border-t border-ink/10 pt-5">
              <p className="font-mono text-xs tracking-[0.1em] text-ink-soft uppercase">
                Colors
              </p>
              <div className="mt-3 flex items-center gap-3">
                {product.colors.map((color) => (
                  <span
                    key={color}
                    style={{
                      background: `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${color} 45%, white) 0%, ${color} 55%, color-mix(in srgb, ${color} 75%, black) 100%)`,
                    }}
                    className="h-9 w-9 rounded-full shadow-[0_1px_2px_rgba(36,33,28,0.25)] ring-1 ring-ink/10"
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
              className="mt-2 hidden w-full rounded-full bg-ink py-4 text-center font-sans text-sm font-medium text-paper transition-colors hover:bg-teal-deep sm:block"
            >
              Notify me
            </NozzleLink>
          </div>
        </div>
      </main>

      <StickyNotify name={product.name} priceSar={product.priceSar} />

      <Footer />
    </div>
  );
}
