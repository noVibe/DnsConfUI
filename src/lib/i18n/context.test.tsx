import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleProvider, useLocale } from "./context";

function DonorTooltipHarness() {
  const { locale, setLocale, t } = useLocale();

  return (
    <>
      <span data-testid="donor-tooltip">{t("profiles.donorTooltip")}</span>
      <button type="button" onClick={() => setLocale(locale === "ru" ? "en" : "ru")}>Switch</button>
    </>
  );
}

describe("LocaleProvider", () => {
  it("updates the DNS donor tooltip when the global locale changes", () => {
    render(
      <LocaleProvider>
        <DonorTooltipHarness />
      </LocaleProvider>
    );

    expect(screen.getByTestId("donor-tooltip")).toHaveTextContent("Запрашивает у этого DNS-резолвера");

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));

    expect(screen.getByTestId("donor-tooltip")).toHaveTextContent("Queries this DNS resolver");
  });
});
