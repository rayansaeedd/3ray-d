"use client";

import Link from "next/link";
import { useNozzlePrint } from "@/hooks/useNozzlePrint";
import type { ComponentProps } from "react";

export function NozzleLink(props: ComponentProps<typeof Link>) {
  const ref = useNozzlePrint<HTMLAnchorElement>();
  return <Link ref={ref} {...props} />;
}
