import { beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom keeps one localStorage for a whole file, so a preference stored by one test - the language, the theme, the
// servers hidden in the monitor - would otherwise be inherited by the next test in that file and decide what it
// renders. Each test starts with none, as a first visit does.
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // No storage in this environment, so there is nothing to carry over either.
  }
});
