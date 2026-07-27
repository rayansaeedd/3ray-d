"use client";

import { useNozzlePrint } from "@/hooks/useNozzlePrint";
import type { ButtonHTMLAttributes } from "react";

export function NozzleButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useNozzlePrint<HTMLButtonElement>();
  return <button ref={ref} {...props} />;
}
