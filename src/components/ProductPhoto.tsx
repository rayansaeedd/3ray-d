"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export function ProductPhoto({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (images.length < 2) return;
    const id = setInterval(() => {
      setActive((i) => (i + 1) % images.length);
    }, 3800);
    return () => clearInterval(id);
  }, [images.length]);

  return (
    <div className="relative h-full w-full">
      {images.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
          className="object-contain transition-opacity duration-1000"
          style={{ opacity: i === active ? 1 : 0 }}
          priority={i === 0}
        />
      ))}
    </div>
  );
}
