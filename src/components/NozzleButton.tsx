"use client";

import { useNozzlePrint } from "@/hooks/useNozzlePrint";
import type { ButtonHTMLAttributes } from "react";

export function NozzleButton({
  cornerRadius,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { cornerRadius?: number }) {
  const ref = useNozzlePrint<HTMLButtonElement>({ cornerRadius });
  return <button ref={ref} {...props} />;
}
