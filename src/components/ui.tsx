import { clsx, type ClassValue } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-steel disabled:cursor-not-allowed disabled:bg-ink/35",
        className
      )}
      {...props}
    />
  );
}

export function SecondaryButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  error
}: {
  label: ReactNode;
  children: ReactNode;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-2 block whitespace-pre-line text-sm text-coral">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-steel focus:ring-2 focus:ring-steel/20";

export const textareaClass =
  "min-h-28 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-steel focus:ring-2 focus:ring-steel/20";
