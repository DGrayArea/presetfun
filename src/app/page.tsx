import { AppTabs } from "@/components/AppTabs";
import { Header } from "@/components/Header";

export default function Home() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <section className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            Built on Meteora Dynamic Bonding Curve
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Design the curve. Launch on it. Or let others launch on yours.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-400">
            Pick a curve shape, an anti-sniper launch fee and how the coin graduates, and see the
            exact curve the program will run before you sign. Publish it as a preset and you earn
            the partner share of trading fees on every coin launched from it.
          </p>
        </section>
        <AppTabs />
      </main>
      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-slate-500">
        You sign every transaction yourself; presetfun never holds your keys. Launching a coin is
        not an endorsement of it.
      </footer>
    </>
  );
}
