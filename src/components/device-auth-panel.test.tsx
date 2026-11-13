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
// that a built-in client ID ships with the app.
const clientIdOverride = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/domain/github-app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/github-app")>();

  return {
    ...actual,
    getGitHubClientId: () =>
      clientIdOverride.value === null ? actual.getGitHubClientId() : clientIdOverride.value,
    isUsingBuiltInGitHubClientId: () =>
      clientIdOverride.value === null
        ? actual.isUsingBuiltInGitHubClientId()
        : clientIdOverride.value === actual.BUILT_IN_GITHUB_CLIENT_ID,
  };
});

const originalClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
const sharedAppTitle = "Эта сборка использует общее GitHub-приложение проекта";
const continueAnyway = "Всё равно продолжить";
const startAuthorization = "Начать подключение к GitHub";

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

describe("DeviceAuthPanel", () => {
  beforeEach(() => {
    deviceFlowMocks.requestCode.mockReset();
    deviceFlowMocks.pollToken.mockReset();
    clientIdOverride.value = null;
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "client-id";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    clientIdOverride.value = null;
    if (originalClientId === undefined) delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    else process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = originalClientId;
  });

  it("shows local developer setup when no client ID is configured at all", () => {
    clientIdOverride.value = "";

    renderPanel();

    expect(screen.getByText("Требуется настройка разработчика")).toBeInTheDocument();
    expect(screen.queryByText(sharedAppTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: startAuthorization })).not.toBeInTheDocument();
  });

  it("warns about the shared GitHub app and blocks authorization until it is acknowledged", () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

    renderPanel();

    expect(screen.getByText(sharedAppTitle)).toBeInTheDocument();
    expect(screen.getByText(/имя владельца проекта/)).toBeInTheDocument();
    expect(screen.getByText(/50 в час/)).toBeInTheDocument();
    expect(screen.getByText(/NEXT_PUBLIC_GITHUB_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/не сохраняет ваш GitHub-токен/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: startAuthorization })).not.toBeInTheDocument();
    expect(deviceFlowMocks.requestCode).not.toHaveBeenCalled();
  });

  it("starts authorization with the shared app only after the warning is acknowledged", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    deviceFlowMocks.requestCode.mockResolvedValue({
      device_code: "device-code",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 60,
    });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: continueAnyway }));

    expect(screen.queryByText(sharedAppTitle)).not.toBeInTheDocument();
    expect(deviceFlowMocks.requestCode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: startAuthorization }));

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
  });

  it("does not warn when an own client ID is configured", () => {
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "Ov23liOwnAppClientId";

    renderPanel();

    expect(screen.queryByText(sharedAppTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: continueAnyway })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: startAuthorization })).toBeInTheDocument();
  });

  it("starts device authorization and copies the user code", async () => {
    deviceFlowMocks.requestCode.mockResolvedValue({
      device_code: "device-code",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 60,
    });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Начать подключение к GitHub" }));

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByRole("link", { name: "Открыть страницу подтверждения GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/login/device",
    );
  });

  it("stores the token after successful polling", async () => {
    deviceFlowMocks.requestCode.mockResolvedValue({
      device_code: "device-code",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 0,
    });
    deviceFlowMocks.pollToken.mockResolvedValue({ access_token: "github-token", token_type: "bearer", scope: "repo" });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Начать подключение к GitHub" }));

    await waitFor(() => expect(screen.getByTestId("token")).toHaveTextContent("github-token"));
    expect(deviceFlowMocks.pollToken).toHaveBeenCalledWith("device-code");
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
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Начать подключение к GitHub" })); });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Перезапустить авторизацию" })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(screen.getByText("BBBB-2222")).toBeInTheDocument();
      expect(deviceFlowMocks.pollToken).toHaveBeenCalledTimes(1);
      expect(deviceFlowMocks.pollToken).toHaveBeenCalledWith("new-code");
    } finally {
      vi.useRealTimers();
    }
  });
});
