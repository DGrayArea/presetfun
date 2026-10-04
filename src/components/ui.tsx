"use client";

import type { ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

import { useAppConfig } from "@/app/providers";
import { explorerUrl } from "@/lib/config";
import { friendlyError } from "@/lib/friendlyError";

/** Shared chrome for the Meteora and Orca panels. */

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder = "0.0",
  mono = true,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-200">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={mono ? "decimal" : undefined}
        placeholder={placeholder}
        className={`h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-base outline-none transition placeholder:text-slate-600 focus:border-accent sm:text-sm ${
          mono ? "font-mono" : ""
        }`}
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Choice<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-200">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition ${
              value === o.value
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-white/10 text-slate-400 hover:bg-white/5"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm break-words text-red-200">
      {typeof children === "string" ? friendlyError(children) : children}
    </div>
  );
}

/**
 * Confirmation banner. Links every signature, not just the first — a withdrawal
 * can land as three transactions and the user should be able to check each.
 */
export function DoneNote({ message, signatures }: { message: string; signatures: string[] }) {
  const { cluster } = useAppConfig();
  if (signatures.length === 0) return null;
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
      {message}{" "}
      {signatures.map((sig, i) => (
        <a
          key={sig}
          href={explorerUrl(cluster, "tx", sig)}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2"
        >
          {signatures.length > 1 ? `Transaction ${i + 1}` : "View on Solscan"}
          {i < signatures.length - 1 ? ", " : ""}
        </a>
      ))}
    </div>
  );
}

export function ConnectGate({ children, prompt }: { children: ReactNode; prompt: string }) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  if (connected) return <>{children}</>;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
      <p className="mb-4 text-sm text-slate-400">{prompt}</p>
      <button
        onClick={() => setVisible(true)}
        className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
      >
        Connect wallet
      </button>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function Submit({
  onClick,
  disabled,
  busy,
  label,
  feeSol,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  feeSol: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full rounded-xl bg-accent px-6 py-4 text-base font-semibold text-accent-ink transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "Confirm in your wallet…" : `${label} · ${feeSol} SOL`}
    </button>
  );
}

export function PoolLookup({
  value,
  onChange,
  onSubmit,
  loading,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  placeholder: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 font-mono text-base outline-none transition placeholder:font-sans placeholder:text-slate-600 focus:border-accent sm:text-sm"
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="h-12 shrink-0 rounded-xl border border-white/15 px-5 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-50"
      >
        {loading ? "Loading…" : "Find pool"}
      </button>
    </form>
  );
}
