"use client";

import Image from "next/image";
import { useState } from "react";

export function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[33/40] items-center justify-center rounded-2xl border border-dashed border-ink/20 bg-stone">
        <span className="px-6 text-center font-mono text-xs tracking-[0.1em] text-ink-soft uppercase">
          Product photo — coming soon
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[33/40] overflow-hidden rounded-2xl bg-stone">
        <Image
          key={images[active]}
          src={images[active]}
          alt={`${alt}, view ${active + 1} of ${images.length}`}
          fill
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-contain"
          priority
        />
      </div>
      {images.length > 1 && (
        <div className="flex gap-3">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show view ${i + 1} of ${images.length}`}
              aria-current={i === active}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border transition-opacity ${
                i === active ? "border-ink" : "border-ink/15 opacity-60 hover:opacity-100"
              }`}
            >
              <Image src={src} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
