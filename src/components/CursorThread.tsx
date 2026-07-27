"use client";

import { useEffect, useRef } from "react";

type Point = { x: number; y: number; t: number; speed: number };

export function CursorThread() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (prefersReduced || !isFinePointer) return;

    document.body.classList.add("js-cursor-active");
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let points: Point[] = [];
    let lastX: number | null = null;
    let lastY: number | null = null;
    let rafId: number;

    function resize() {
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function onPointerMove(e: PointerEvent) {
      const now = performance.now();
      const speed = lastX === null ? 0 : Math.hypot(e.clientX - lastX, e.clientY - (lastY as number));
      lastX = e.clientX;
      lastY = e.clientY;
      points.push({ x: e.clientX, y: e.clientY, t: now, speed });
      if (points.length > 40) points.shift();
    }
    window.addEventListener("pointermove", onPointerMove);

    function draw() {
      const now = performance.now();
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
      points = points.filter((p) => now - p.t < 420);

      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const age = (now - b.t) / 420;
        const speedFactor = Math.min(1, b.speed / 40);
        let width = 2.6 - speedFactor * 1.7 - age * 1.1;
        if (width < 0.4) width = 0.4;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.strokeStyle = `rgba(79, 214, 196, ${0.55 * (1 - age)})`;
        ctx!.lineWidth = width;
        ctx!.lineCap = "round";
        ctx!.stroke();
      }

      if (lastX !== null && lastY !== null) {
        ctx!.beginPath();
        ctx!.arc(lastX, lastY, 5, 0, Math.PI * 2);
        ctx!.strokeStyle = "rgba(250, 247, 240, 0.85)";
        ctx!.lineWidth = 1.2;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(lastX, lastY, 1.4, 0, Math.PI * 2);
        ctx!.fillStyle = "#4fd6c4";
        ctx!.fill();
      }

      rafId = requestAnimationFrame(draw);
    }
    rafId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(rafId);
      document.body.classList.remove("js-cursor-active");
    };
  }, []);

  return <canvas id="cursor-thread-canvas" ref={canvasRef} aria-hidden />;
}
