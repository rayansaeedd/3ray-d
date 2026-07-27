"use client";

import Link from "next/link";
import { useNozzlePrint } from "@/hooks/useNozzlePrint";
import type { ComponentProps } from "react";

export function NozzleLink({
  cornerRadius,
  ...props
}: ComponentProps<typeof Link> & { cornerRadius?: number }) {
  const ref = useNozzlePrint<HTMLAnchorElement>({ cornerRadius });
  return <Link ref={ref} {...props} />;
}
