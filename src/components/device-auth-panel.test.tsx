import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-provider";
import { DeviceAuthPanel } from "./device-auth-panel";
import { LocaleProvider } from "@/lib/i18n/context";

const deviceFlowMocks = vi.hoisted(() => ({
  requestCode: vi.fn(),
  pollToken: vi.fn(),
}));

vi.mock("@/lib/github/device-flow", () => ({
  requestGitHubDeviceCode: deviceFlowMocks.requestCode,
  pollGitHubDeviceToken: deviceFlowMocks.pollToken,
}));

// `null` keeps the real, env-driven behaviour; a string forces that client ID,
// which is the only way to reach the "nothing configured at all" state now
// that a built-in client ID ships with the app. Nothing else is faked here:
// `isUsingBuiltInGitHubClientId` is asked about the ID the panel is actually
// authorizing with, which is the one the user typed when they typed one.
const clientIdOverride = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/domain/github-app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/github-app")>();

  return {
    ...actual,
    getGitHubClientId: () =>
      clientIdOverride.value === null ? actual.getGitHubClientId() : clientIdOverride.value,
  };
});

const originalClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
const sharedAppTitle = "Вы входите через общее GitHub-приложение проекта";
const ownAppTitle = "Вы входите через своё GitHub-приложение";
const startAuthorization = "Начать подключение к GitHub";
const OWN_CLIENT_ID = "Ov23liOwnAppClientId";

const deviceCode = {
  device_code: "device-code",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 60,
};

function TokenProbe() {
  const { token } = useAuth();
  return <output data-testid="token">{token ?? "none"}</output>;
}

function renderPanel() {
  return render(
    <LocaleProvider>
      <AuthProvider>
        <DeviceAuthPanel />
        <TokenProbe />
      </AuthProvider>
    </LocaleProvider>,
  );
}

/** Types a client ID into the panel's own field and applies it, as a user running this locally would. */
function applyOwnClientId(value = OWN_CLIENT_ID) {
  fireEvent.change(screen.getByLabelText("Client ID вашего OAuth App"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Применить" }));
}

describe("DeviceAuthPanel", () => {
  beforeEach(() => {
    deviceFlowMocks.requestCode.mockReset();
    deviceFlowMocks.pollToken.mockReset();
    clientIdOverride.value = null;
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "client-id";
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    clientIdOverride.value = null;
    window.localStorage.clear();
    if (originalClientId === undefined) delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    else process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = originalClientId;
  });

  it("offers the field instead of developer instructions when the build has no client ID", () => {
    clientIdOverride.value = "";

    renderPanel();

    expect(screen.getByText("Нет GitHub-приложения для входа")).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID вашего OAuth App")).toBeInTheDocument();
    expect(screen.queryByText(sharedAppTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: startAuthorization })).not.toBeInTheDocument();
  });

  it("folds the shared-app notice away instead of standing between the user and the button", () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

    renderPanel();

    // The notice is one line until it is asked for: the detail is in the document but not on the screen.
    expect(screen.getByText(sharedAppTitle)).toBeVisible();
    expect(screen.getByText(/имя владельца проекта/)).not.toBeVisible();
    expect(screen.getByText(/50 в час/)).not.toBeVisible();
    expect(screen.getByText(/не сохраняет ваш GitHub-токен/)).not.toBeVisible();
    expect(screen.getByRole("button", { name: startAuthorization })).toBeVisible();
  });

  it("starts authorization with the shared app without anything to acknowledge first", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    deviceFlowMocks.requestCode.mockResolvedValue(deviceCode);

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: startAuthorization }));

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    // An empty string is "whatever this build has", so the browser never dictates the shared app's ID.
    expect(deviceFlowMocks.requestCode).toHaveBeenCalledWith("");
  });

  it("does not call it a shared app when the build configures one of its own", () => {
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = OWN_CLIENT_ID;

    renderPanel();

    expect(screen.queryByText(sharedAppTitle)).not.toBeInTheDocument();
    expect(screen.getByText(ownAppTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: startAuthorization })).toBeInTheDocument();
  });

  it("authorizes through a client ID typed into the panel, with nothing rebuilt", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    deviceFlowMocks.requestCode.mockResolvedValue(deviceCode);
    deviceFlowMocks.pollToken.mockResolvedValue({ error: "authorization_pending" });

    renderPanel();
    applyOwnClientId();

    expect(screen.getByText(ownAppTitle)).toBeInTheDocument();
    expect(screen.queryByText(sharedAppTitle)).not.toBeInTheDocument();
    expect(screen.getByText(`Используется ваш client ID: ${OWN_CLIENT_ID}.`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: startAuthorization }));

    await screen.findByText("ABCD-1234");
    expect(deviceFlowMocks.requestCode).toHaveBeenCalledWith(OWN_CLIENT_ID);
  });

  it("remembers the typed client ID for the next time the page is opened", () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

    const first = renderPanel();
    applyOwnClientId();
    first.unmount();

    renderPanel();

    expect(screen.getByText(ownAppTitle)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID вашего OAuth App")).toHaveValue(OWN_CLIENT_ID);
  });

  it("goes back to the shared app when the typed client ID is forgotten", () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

    renderPanel();
    applyOwnClientId();
    fireEvent.click(screen.getByRole("button", { name: "вернуться к общему приложению" }));

    expect(screen.getByText(sharedAppTitle)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID вашего OAuth App")).toHaveValue("");
    expect(window.localStorage.length).toBe(0);
  });

  it("refuses a value that cannot be a client ID instead of authorizing with it", () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

    renderPanel();
    applyOwnClientId("not a client id");

    expect(screen.getByText(/не похоже на Client ID/)).toBeInTheDocument();
    expect(screen.getByText(sharedAppTitle)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID вашего OAuth App")).toHaveAttribute("aria-invalid", "true");
  });

  it("offers the field again when authorization fails, which is when it is wanted most", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    deviceFlowMocks.requestCode.mockResolvedValue({ ...deviceCode, interval: 0 });
    // Hitting the shared app's hourly limit looks like this, and the way out of it is an app of one's own.
    deviceFlowMocks.pollToken.mockResolvedValue({ error: "access_denied", error_description: "denied" });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: startAuthorization }));

    expect(await screen.findByText("denied")).toBeInTheDocument();
    expect(screen.queryByText("ABCD-1234")).not.toBeInTheDocument();
    expect(screen.getByText(sharedAppTitle)).toBeInTheDocument();

    applyOwnClientId();

    // The code it was polling could only ever be redeemed by the app that issued it, so it goes with the app.
    expect(screen.getByText(ownAppTitle)).toBeInTheDocument();
    expect(screen.queryByText("denied")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: startAuthorization })).toBeInTheDocument();
  });

  it("starts device authorization and copies the user code", async () => {
    deviceFlowMocks.requestCode.mockResolvedValue(deviceCode);

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: startAuthorization }));

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByRole("link", { name: "Открыть страницу подтверждения GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/login/device",
    );
  });

  it("stores the token after successful polling", async () => {
    deviceFlowMocks.requestCode.mockResolvedValue({ ...deviceCode, interval: 0 });
    deviceFlowMocks.pollToken.mockResolvedValue({ access_token: "github-token", token_type: "bearer", scope: "repo" });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: startAuthorization }));

    await waitFor(() => expect(screen.getByTestId("token")).toHaveTextContent("github-token"));
    expect(deviceFlowMocks.pollToken).toHaveBeenCalledWith("device-code", "");
  });

  it("polls with the client ID the code was issued to", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    deviceFlowMocks.requestCode.mockResolvedValue({ ...deviceCode, interval: 0 });
    deviceFlowMocks.pollToken.mockResolvedValue({ access_token: "github-token", token_type: "bearer", scope: "repo" });

    renderPanel();
    applyOwnClientId();
    fireEvent.click(screen.getByRole("button", { name: startAuthorization }));

    await waitFor(() => expect(screen.getByTestId("token")).toHaveTextContent("github-token"));
    expect(deviceFlowMocks.pollToken).toHaveBeenCalledWith("device-code", OWN_CLIENT_ID);
  });

  it("stops polling the old code when authorization is restarted", async () => {
    vi.useFakeTimers();
    try {
      const device = { verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };
      deviceFlowMocks.requestCode
        .mockResolvedValueOnce({ ...device, device_code: "old-code", user_code: "AAAA-1111" })
        .mockResolvedValueOnce({ ...device, device_code: "new-code", user_code: "BBBB-2222" });
      deviceFlowMocks.pollToken.mockResolvedValue({ error: "authorization_pending" });

      renderPanel();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: startAuthorization })); });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Перезапустить авторизацию" })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(screen.getByText("BBBB-2222")).toBeInTheDocument();
      expect(deviceFlowMocks.pollToken).toHaveBeenCalledTimes(1);
      expect(deviceFlowMocks.pollToken).toHaveBeenCalledWith("new-code", "");
    } finally {
      vi.useRealTimers();
    }
  });
});
