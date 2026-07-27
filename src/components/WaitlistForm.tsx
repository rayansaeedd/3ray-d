"use client";

import { useState } from "react";
import { NozzleButton } from "@/components/NozzleButton";

export function WaitlistForm() {
  const [status, setStatus] = useState<"idle" | "submitted">("idle");

  return (
    <div id="waitlist" className="scroll-mt-24">
      {status === "idle" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStatus("submitted");
          }}
          className="flex w-full max-w-md flex-col gap-3 sm:flex-row"
        >
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-full border border-ink/25 bg-paper/60 px-5 py-3 font-sans text-sm text-ink placeholder:text-ink-soft/70 focus:border-ink/60 focus:outline-none"
          />
          <NozzleButton
            type="submit"
            className="shrink-0 rounded-full bg-ink px-6 py-3 font-mono text-xs tracking-[0.12em] text-paper uppercase transition-colors hover:bg-teal-deep"
          >
            Notify me
          </NozzleButton>
        </form>
      ) : (
        <p className="font-sans text-sm text-ink-soft">
          You&apos;re on the list — we&apos;ll email you the moment Planters launches.
        </p>
      )}
    </div>
  );
}
