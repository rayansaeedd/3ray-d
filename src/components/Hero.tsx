import { generateVasePath } from "@/lib/spiral";
import { WaitlistForm } from "@/components/WaitlistForm";
import type { Category } from "@/lib/categories";

export function Hero({ category }: { category: Category }) {
  const width = 320;
  const height = 400;
  const path = generateVasePath({
    width,
    height,
    turns: 16,
    pointsPerTurn: 10,
  });

  return (
    <section className="flex min-h-screen flex-col justify-center gap-14 px-6 pt-28 pb-16 sm:px-10 lg:flex-row lg:items-center lg:gap-10 lg:pt-24">
      <div className="flex max-w-xl flex-col gap-7 pr-14 lg:pr-0">
        <p className="font-mono text-xs tracking-[0.22em] text-teal uppercase">
          {category.eyebrow}
        </p>
        <h1 className="font-display text-6xl leading-[0.95] text-ink sm:text-7xl">
          {category.headline.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="max-w-md font-sans text-lg leading-relaxed text-ink-soft">
          {category.description}
        </p>
        <WaitlistForm />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-64 sm:w-80"
          role="img"
          aria-label={`Illustration of a ${category.name.toLowerCase()} traced as a single spiral line`}
        >
          <path
            d={path}
            fill="none"
            stroke="var(--nabtah-teal)"
            strokeWidth="1.4"
            strokeLinecap="round"
            pathLength={1}
            className="spiral-path"
          />
        </svg>
      </div>
    </section>
  );
}
