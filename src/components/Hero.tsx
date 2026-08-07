import { WaitlistForm } from "@/components/WaitlistForm";
import { ProductPhoto } from "@/components/ProductPhoto";
import type { Category } from "@/lib/categories";

export function Hero({ category }: { category: Category }) {
  const [first, second, third] = category.products;

  return (
    <section className="flex flex-col gap-16 px-6 pt-32 pb-20 sm:px-10 sm:pt-36">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
        <p className="font-sans text-sm text-ink-soft">{category.eyebrow}</p>
        <h1 className="font-display text-5xl font-bold leading-[1.05] text-ink sm:text-6xl lg:text-7xl">
          {category.headline.join(" ")}
        </h1>
        <p className="max-w-md font-sans text-lg leading-relaxed text-ink-soft">
          {category.description}
        </p>
        <WaitlistForm />
      </div>

      {first?.images && first.images.length > 0 && (
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 rounded-[2.5rem] bg-stone px-6 py-16 sm:px-16 sm:py-20">
          <div className="relative mx-auto flex h-[260px] w-full max-w-3xl items-center justify-center sm:h-[320px]">
            {third && (
              <div className="absolute left-[4%] top-[8%] h-36 w-28 -rotate-6 overflow-hidden rounded-2xl border-4 border-paper shadow-xl sm:left-[8%] sm:h-52 sm:w-40">
                <ProductPhoto images={third.images ?? []} alt={third.name} />
              </div>
            )}

            <div className="relative z-10 h-48 w-36 overflow-hidden rounded-2xl border-4 border-paper shadow-2xl sm:h-64 sm:w-48">
              <ProductPhoto images={first.images ?? []} alt={first.name} />
            </div>

            {second && (
              <div className="absolute right-[4%] top-[14%] h-32 w-24 rotate-6 overflow-hidden rounded-2xl border-4 border-paper shadow-xl sm:right-[8%] sm:h-44 sm:w-32">
                <ProductPhoto images={second.images ?? []} alt={second.name} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-thread" />
            <span className="font-sans text-xs whitespace-nowrap text-paper">
              Printed in a single line
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
