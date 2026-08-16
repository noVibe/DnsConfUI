import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleProvider, useLocale } from "./context";

function DonorTooltipHarness() {
  const { locale, setLocale, t } = useLocale();

  return (
    <>
      <span data-testid="donor-tooltip">{t("profiles.donorTooltip")}</span>
      <span data-testid="retained-tooltip">{t("quick.unavailableDesc")}</span>
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
    expect(screen.getByTestId("retained-tooltip")).toHaveTextContent("Настройки ниже невозможно изменить без ввода CLIENT_ID и AUTH_SECRET");

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));

    expect(screen.getByTestId("donor-tooltip")).toHaveTextContent("Queries this DNS resolver");
    expect(screen.getByTestId("retained-tooltip")).toHaveTextContent("The settings below cannot be changed without entering CLIENT_ID and AUTH_SECRET");
  });
});
