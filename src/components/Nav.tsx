import Link from "next/link";
import { NozzleLink } from "@/components/NozzleLink";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-ink/5 bg-paper px-6 py-5 sm:px-10">
      <Link href="/" className="font-display text-lg font-bold text-ink">
        Nabtah
      </Link>
      <NozzleLink
        href="/#waitlist"
        className="rounded-full bg-ink px-5 py-2.5 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink/85"
      >
        Notify me
      </NozzleLink>
    </header>
  );
}
