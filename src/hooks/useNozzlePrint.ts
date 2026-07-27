"use client";

import { useEffect, useRef } from "react";

/**
 * Makes an element "print" its own outline on hover/focus (desktop) and on
 * every tap (all pointer types), plus a small heat-pulse where it was
 * pressed — echoing the vase-mode single-line print the products are made
 * with.
 */
export function useNozzlePrint<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
    el.style.isolation = "isolate";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.style.position = "absolute";
    svg.style.inset = "-1px";
    svg.style.width = "calc(100% + 2px)";
    svg.style.height = "calc(100% + 2px)";
    svg.style.overflow = "visible";
    svg.style.pointerEvents = "none";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("pathLength", "1");
    path.setAttribute("class", "nozzle-outline-path");
    svg.appendChild(path);
    el.appendChild(svg);

    function layout() {
      const w = el!.offsetWidth + 2;
      const h = el!.offsetHeight + 2;
      const r = h / 2;
      if (w <= 2 || h <= 2) return;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      const d =
        `M ${r} 1 H ${w - r} ` +
        `A ${r - 1} ${r - 1} 0 0 1 ${w - r} ${h - 1} ` +
        `H ${r} ` +
        `A ${r - 1} ${r - 1} 0 0 1 ${r} 1 Z`;
      path.setAttribute("d", d);
    }
    layout();

    const ro = new ResizeObserver(layout);
    ro.observe(el);

    let printTimer: ReturnType<typeof setTimeout>;
    const addPrinting = () => el!.classList.add("is-printing");
    const removePrinting = () => el!.classList.remove("is-printing");

    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === "mouse") addPrinting();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") removePrinting();
    };
    const onFocus = () => addPrinting();
    const onBlur = () => removePrinting();
    const onDown = (e: PointerEvent) => {
      const rect = el!.getBoundingClientRect();
      const dot = document.createElement("span");
      dot.className = "nozzle-pulse";
      dot.style.left = `${e.clientX - rect.left}px`;
      dot.style.top = `${e.clientY - rect.top}px`;
      el!.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove());

      addPrinting();
      clearTimeout(printTimer);
      printTimer = setTimeout(removePrinting, 900);
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", onDown);

    return () => {
      ro.disconnect();
      clearTimeout(printTimer);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", onDown);
      svg.remove();
    };
  }, []);

  return ref;
}
