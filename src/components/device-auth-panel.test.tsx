import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

const originalClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

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
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "client-id";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    else process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = originalClientId;
  });

  it("shows local developer setup when the client ID is missing", () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

    renderPanel();

    expect(screen.getByText("Требуется настройка разработчика")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Начать подключение к GitHub" })).not.toBeInTheDocument();
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
});
