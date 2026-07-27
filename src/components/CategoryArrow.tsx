import Link from "next/link";
import type { Category } from "@/lib/categories";

export function CategoryArrow({
  target,
  direction = "next",
}: {
  target: Category;
  direction?: "next" | "back";
}) {
  const isBack = direction === "back";
  const label = isBack
    ? `Back to ${target.name}`
    : target.live
      ? `Next: ${target.name}`
      : `${target.name} — coming soon`;

  return (
    <Link
      href={`/${target.slug}`}
      aria-label={label}
      className={`group fixed z-40 flex items-center gap-3 bottom-6 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 ${
        isBack ? "left-4 sm:left-6 flex-row-reverse" : "right-4 sm:right-6"
      }`}
    >
      <span
        className={`pointer-events-none absolute whitespace-nowrap rounded-full bg-ink px-3 py-1.5 font-mono text-[11px] tracking-[0.1em] text-paper uppercase opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
          isBack ? "left-full ml-3" : "right-full mr-3"
        }`}
      >
        {label}
      </span>
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/25 bg-paper/70 backdrop-blur transition-colors duration-200 group-hover:border-ink/60 group-hover:bg-paper">
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          className={`text-ink transition-transform duration-200 ${
            isBack
              ? "rotate-180 group-hover:-translate-x-0.5"
              : "group-hover:translate-x-0.5"
          }`}
        >
          <path
            d="M2 9H16M16 9L10 3M16 9L10 15"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Link>
  );
}
