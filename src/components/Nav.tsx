import Link from "next/link";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-6 py-5 sm:px-10">
      <Link
        href="/"
        className="font-mono text-sm tracking-[0.2em] text-ink uppercase"
      >
        Nabtah
      </Link>
      <Link
        href="/#waitlist"
        className="rounded-full border border-ink/20 px-4 py-2 font-mono text-xs tracking-[0.12em] text-ink uppercase transition-colors hover:border-ink/60"
      >
        Notify me
      </Link>
    </header>
  );
}
