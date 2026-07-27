const METHODS = ["mada", "Visa", "Mastercard", "Apple Pay", "STC Pay"];

export function PaymentBand() {
  return (
    <section className="bg-basalt px-6 py-20 text-paper sm:px-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
        <p className="font-mono text-xs tracking-[0.2em] text-sage uppercase">
          Checkout
        </p>
        <h2 className="font-display text-3xl font-bold sm:text-4xl">
          Built for how Saudi Arabia pays.
        </h2>
        <p className="max-w-lg font-sans text-sm leading-relaxed text-paper/70">
          Secure checkout — including mada — launches alongside the first
          collection. No payment is collected on this page yet.
        </p>
        <ul className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {METHODS.map((method) => (
            <li
              key={method}
              className="rounded-full border border-paper/20 px-4 py-2 font-mono text-xs tracking-[0.05em] text-paper/80"
            >
              {method}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
