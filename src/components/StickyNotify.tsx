"use client";

import { useEffect, useState } from "react";
import { NozzleLink } from "@/components/NozzleLink";

export function StickyNotify({
  name,
  priceSar,
}: {
  name: string;
  priceSar?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-ink/10 bg-paper/95 px-5 py-4 shadow-[0_-8px_24px_rgba(36,33,28,0.1)] backdrop-blur transition-transform duration-300 sm:hidden ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-bold text-ink">{name}</p>
        <p className="font-mono text-xs text-ink-soft">
          {priceSar ? `SAR ${priceSar}` : "Price — coming soon"}
        </p>
      </div>
      <NozzleLink
        href="/#waitlist"
        className="shrink-0 rounded-full bg-ink px-6 py-3 font-sans text-sm font-medium text-paper transition-colors hover:bg-teal-deep"
      >
        Notify me
      </NozzleLink>
    </div>
  );
}
