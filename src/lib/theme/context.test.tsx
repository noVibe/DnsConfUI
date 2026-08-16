import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./context";

function ThemeHarness() {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" onClick={toggleTheme}>{theme}</button>;
}

describe("ThemeProvider", () => {
  let changeHandler: ((event: MediaQueryListEvent) => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn((_type: string, handler: (event: MediaQueryListEvent) => void) => { changeHandler = handler; }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("toggles the theme and persists the choice", () => {
    render(<ThemeProvider><ThemeHarness /></ThemeProvider>);

    fireEvent.click(screen.getByRole("button", { name: "light" }));

    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("dnsconf-theme")).toBe("dark");
  });

  it("reacts to a system theme change when no preference is stored", () => {
    render(<ThemeProvider><ThemeHarness /></ThemeProvider>);

    act(() => changeHandler?.({ matches: true } as MediaQueryListEvent));

    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("dnsconf-theme")).toBeNull();

    act(() => changeHandler?.({ matches: false } as MediaQueryListEvent));
    expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("dnsconf-theme")).toBeNull();
  });

  it("applies a stored theme on mount", async () => {
    localStorage.setItem("dnsconf-theme", "dark");

    render(<ThemeProvider><ThemeHarness /></ThemeProvider>);

    await waitFor(() => expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument());
    expect(document.documentElement).toHaveClass("dark");
  });

  it("applies the initial system theme without persisting it", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    render(<ThemeProvider><ThemeHarness /></ThemeProvider>);

    await waitFor(() => expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument());
    expect(localStorage.getItem("dnsconf-theme")).toBeNull();
  });
});
