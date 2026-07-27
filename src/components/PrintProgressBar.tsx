"use client";

import { useEffect, useRef } from "react";

const TICK_COUNT = 40;

export function PrintProgressBar() {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function update() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const frac = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (fillRef.current) fillRef.current.style.width = `${frac * 100}%`;
      if (headRef.current) headRef.current.style.left = `${frac * 100}%`;
    }
    update();
    document.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-[3px]"
    >
      <div className="print-bar-track" />
      <div className="print-bar-ticks">
        {Array.from({ length: TICK_COUNT }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      <div ref={fillRef} className="print-bar-fill" />
      <div ref={headRef} className="print-bar-head" />
    </div>
  );
}
