import { describe, expect, it, vi } from "vitest";
import { GEOHIDE_HOSTS_LIST } from "@/domain/toggles";
import { loadExistingDnsConfSetup, provisionDnsConfRepository, starRepository } from "./provisioning";

describe("provisionDnsConfRepository", () => {
  it("forks DnsConf, uploads encrypted secrets, upserts variables, and dispatches the workflow", async () => {
    let forkExists = false;
    const request = vi.fn(async (route: string) => {
      if (route === "GET /repos/{owner}/{repo}/environments/{environment_name}") {
        throw Object.assign(new Error("Environment not found"), { status: 404 });
      }
      if (route === "GET /user") {
        return { data: { login: "alice" } };
      }
      if (route === "GET /repos/{owner}/{repo}") {
        if (!forkExists) {
          throw Object.assign(new Error("Not found"), { status: 404 });
        }
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      }
      if (route === "POST /repos/{owner}/{repo}/forks") {
        forkExists = true;
        return { data: {} };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 1, html_url: "https://github.com/alice/DnsConf/actions/runs/1" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      return { data: {} };
    });
    const encryptSecret = vi.fn(async (value: string) => `encrypted:${value}`);

    const result = await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", DONOR_DNS: "https://dns.geohide.ru:444/dns-query", BLOCK: "https://example.com/list", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret
    });

    expect(result.repository).toEqual({ owner: "alice", repo: "DnsConf" });
    expect(result.workflowRunUrl).toBe("https://github.com/alice/DnsConf/actions/runs/1");
    expect(request).toHaveBeenCalledWith("GET /user");
    expect(request).toHaveBeenCalledWith("GET /repos/{owner}/{repo}", {
      owner: "alice", repo: "DnsConf"
    });
    expect(request).toHaveBeenCalledWith("POST /repos/{owner}/{repo}/forks", {
      owner: "noVibe",
      repo: "DnsConf"
    });
    expect(request).not.toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/merge-upstream",
      expect.anything()
    );
    expect(request).toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}",
      expect.objectContaining({
        owner: "alice",
        repo: "DnsConf",
        secret_name: "AUTH_SECRET",
        encrypted_value: "encrypted:secret",
        key_id: "key-id"
      })
    );
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/environments/{environment_name}/variables",
      expect.objectContaining({ environment_name: "DNS", name: "DNS", value: "cloudflare" })
    );
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/environments/{environment_name}/variables",
      expect.objectContaining({ environment_name: "DNS", name: "DONOR_DNS", value: "https://dns.geohide.ru:444/dns-query" })
    );
    expect(request).toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/environments/{environment_name}",
      { owner: "alice", repo: "DnsConf", environment_name: "DNS" }
    );
    expect(request).not.toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/actions/variables",
      expect.anything()
    );
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
      {
        owner: "alice",
        repo: "DnsConf",
        workflow_id: "github_action.yml",
        ref: "main"
      }
    );
  });

  it("reuses existing fork when one already exists", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") {
        return { data: { login: "alice" } };
      }
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 1, html_url: "https://github.com/alice/DnsConf/actions/runs/1" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      return { data: {} };
    });

    const result = await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    });

    expect(result.repository).toEqual({ owner: "alice", repo: "DnsConf" });
    expect(request).not.toHaveBeenCalledWith("POST /repos/{owner}/{repo}/forks", expect.anything());
    expect(request).toHaveBeenCalledWith("POST /repos/{owner}/{repo}/merge-upstream", {
      owner: "alice",
      repo: "DnsConf",
      branch: "main"
    });

    const syncCallIndex = request.mock.calls.findIndex(([route]) => route === "POST /repos/{owner}/{repo}/merge-upstream");
    const secretsCallIndex = request.mock.calls.findIndex(([route]) => route === "GET /repos/{owner}/{repo}/actions/secrets/public-key");
    expect(syncCallIndex).toBeGreaterThan(-1);
    expect(syncCallIndex).toBeLessThan(secretsCallIndex);
  });

  it("uses the upstream repository directly when the authenticated user owns it", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "noVibe" } };
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { owner: { login: "noVibe" }, name: "DnsConf", fork: false } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 11, html_url: "https://github.com/noVibe/DnsConf/actions/runs/11" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      return { data: {} };
    });

    const result = await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    });

    expect(result.repository).toEqual({ owner: "noVibe", repo: "DnsConf" });
    expect(request).not.toHaveBeenCalledWith("POST /repos/{owner}/{repo}/forks", expect.anything());
    expect(request).not.toHaveBeenCalledWith("POST /repos/{owner}/{repo}/merge-upstream", expect.anything());
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/environments/{environment_name}/variables",
      expect.objectContaining({ owner: "noVibe", repo: "DnsConf", environment_name: "DNS", name: "DNS" })
    );
  });

  it("fails before configuration when an existing fork cannot be synchronized", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") {
        return { data: { login: "alice" } };
      }
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      }
      if (route === "POST /repos/{owner}/{repo}/merge-upstream") {
        throw new Error("Fork has conflicts");
      }
      return { data: {} };
    });

    await expect(provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    })).rejects.toThrow("Fork has conflicts");

    expect(request).not.toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/secrets/public-key",
      expect.anything()
    );
  });

  it("updates existing GitHub Actions variables instead of failing on conflict", async () => {
    let forkExists = false;
    const request = vi.fn(async (route: string, parameters?: Record<string, unknown>) => {
      if (route === "GET /user") {
        return { data: { login: "alice" } };
      }
      if (route === "GET /repos/{owner}/{repo}") {
        if (!forkExists) {
          throw Object.assign(new Error("Not found"), { status: 404 });
        }
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      }
      if (route === "POST /repos/{owner}/{repo}/forks") {
        forkExists = true;
        return { data: {} };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 1, html_url: "https://github.com/alice/DnsConf/actions/runs/1" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      if (
        route === "POST /repos/{owner}/{repo}/environments/{environment_name}/variables" &&
        parameters?.name === "DNS"
      ) {
        throw Object.assign(new Error("Variable already exists"), { status: 409 });
      }
      return { data: {} };
    });

    await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    });

    expect(request).toHaveBeenCalledWith(
      "PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}",
      {
        owner: "alice",
        repo: "DnsConf",
        environment_name: "DNS",
        name: "DNS",
        value: "cloudflare"
      }
    );
  });

  it("treats GitHub 422 already-exists responses as variable update cases", async () => {
    let forkExists = false;
    const request = vi.fn(async (route: string, parameters?: Record<string, unknown>) => {
      if (route === "GET /user") {
        return { data: { login: "alice" } };
      }
      if (route === "GET /repos/{owner}/{repo}") {
        if (!forkExists) {
          throw Object.assign(new Error("Not found"), { status: 404 });
        }
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      }
      if (route === "POST /repos/{owner}/{repo}/forks") {
        forkExists = true;
        return { data: {} };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 1, html_url: "https://github.com/alice/DnsConf/actions/runs/1" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      if (
        route === "POST /repos/{owner}/{repo}/environments/{environment_name}/variables" &&
        parameters?.name === "BLOCK"
      ) {
        throw Object.assign(new Error("Variable already exists"), { response: { status: 422 } });
      }
      return { data: {} };
    });

    await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", DONOR_DNS: "-", BLOCK: "https://example.com/list", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    });

    expect(request).toHaveBeenCalledWith(
      "PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}",
      {
        owner: "alice",
        repo: "DnsConf",
        environment_name: "DNS",
        name: "BLOCK",
        value: "https://example.com/list"
      }
    );
  });

  it("reports a failed workflow conclusion", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") return { data: { fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 9, html_url: "https://example.test/run/9" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "failure" } };
      }
      return { data: {} };
    });

    await expect(provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "nextdns", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" },
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`,
    })).rejects.toThrow("Workflow run finished with conclusion: failure");
  });

  it("deletes variables with empty values so existing repository values are cleared", async () => {
    const steps: string[] = [];
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") return { data: { fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 1, html_url: "https://example.test/run/1" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      if (route === "PUT /repos/{owner}/{repo}/actions/permissions") {
        throw new Error("permissions endpoint unavailable");
      }
      return { data: {} };
    });

    await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "nextdns", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" },
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`,
      onStep: (step) => { steps.push(step); },
    });

    expect(steps).toEqual(["fork", "secrets", "dispatch"]);
    expect(request).toHaveBeenCalledWith(
      "DELETE /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}",
      { owner: "alice", repo: "DnsConf", environment_name: "DNS", name: "BLOCK" },
    );
    expect(request).not.toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/environments/{environment_name}/variables",
      expect.objectContaining({ value: "" }),
    );
    expect(request).not.toHaveBeenCalledWith(
      "PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}",
      expect.objectContaining({ value: "" }),
    );
  });

  it("ignores missing variables when applying empty values", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "DELETE /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}") {
        throw Object.assign(new Error("Variable not found"), { status: 404 });
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 1, html_url: "https://example.test/run/1" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      return { data: {} };
    });

    await expect(provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "nextdns", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" },
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`,
    })).resolves.toEqual(expect.objectContaining({ repository: { owner: "alice", repo: "DnsConf" } }));
  });

  it("rethrows variable creation errors that are not conflicts", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") return { data: { fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "POST /repos/{owner}/{repo}/environments/{environment_name}/variables") {
        throw Object.assign(new Error("server error"), { status: 500 });
      }
      return { data: {} };
    });

    await expect(provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "nextdns", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" },
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`,
    })).rejects.toThrow("server error");
  });

  it("retains existing GitHub secrets while updating variables", async () => {
    const request = vi.fn(async (route: string, parameters?: Record<string, unknown>) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") return { data: { fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      if (
        route === "POST /repos/{owner}/{repo}/environments/{environment_name}/variables" &&
        parameters?.name === "DNS"
      ) {
        throw Object.assign(new Error("Variable already exists"), { status: 409 });
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 7, html_url: "https://example.test/run/7" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}") {
        return { data: { status: "completed", conclusion: "success" } };
      }
      return { data: {} };
    });
    const encryptSecret = vi.fn(async (value: string) => `encrypted:${value}`);

    await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: {},
        variables: { DNS: "nextdns", DONOR_DNS: "-", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret,
      retainCredentials: true,
      variableEnvironment: "dns"
    });

    expect(request).not.toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/secrets/public-key",
      expect.anything()
    );
    expect(request).not.toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}",
      expect.anything()
    );
    expect(encryptSecret).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/environments/{environment_name}/variables",
      expect.objectContaining({ environment_name: "dns", name: "DONOR_DNS", value: "-" })
    );
    expect(request).toHaveBeenCalledWith(
      "PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}",
      expect.objectContaining({ environment_name: "dns", name: "DNS", value: "nextdns" })
    );
  });
});

describe("loadExistingDnsConfSetup", () => {
  it("loads readable variables and derives profiles from DNS", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") return { data: { fork: true, parent: { full_name: "noVibe/DnsConf" } } };
      if (route === "GET /repos/{owner}/{repo}/actions/variables") {
        return { data: { variables: [
          { name: "DNS", value: "nextdns,cloudflare" },
          { name: "DONOR_DNS", value: "-,https://dns.comss.one/dns-query" },
          { name: "UNRELATED", value: "ignored" }
        ] } };
      }
      return { data: {} };
    });

    const result = await loadExistingDnsConfSetup(request, "noVibe", "DnsConf");

    expect(result?.repository).toEqual({ owner: "alice", repo: "DnsConf" });
    expect(result?.variableEnvironment).toBe("DNS");
    expect(result?.variables).toEqual({
      DNS: "nextdns,cloudflare",
      DONOR_DNS: "-,https://dns.comss.one/dns-query"
    });
    expect(result?.config?.profiles).toEqual([
      { clientId: "", authSecret: "", provider: "nextdns", donorDns: "" },
      { clientId: "", authSecret: "", provider: "cloudflare", donorDns: "https://dns.comss.one/dns-query" }
    ]);
    expect(request).toHaveBeenCalledWith("GET /repos/{owner}/{repo}/actions/variables", {
      owner: "alice",
      repo: "DnsConf",
      per_page: 30
    });
  });

  it("loads the upstream repository for its authenticated owner", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "noVibe" } };
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { owner: { login: "noVibe" }, name: "DnsConf", fork: false } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/variables") {
        return { data: { variables: [{ name: "DNS", value: "nextdns" }] } };
      }
      return { data: {} };
    });

    const result = await loadExistingDnsConfSetup(request, "noVibe", "DnsConf");

    expect(result?.repository).toEqual({ owner: "noVibe", repo: "DnsConf" });
    expect(result?.config?.profiles).toEqual([
      expect.objectContaining({ provider: "nextdns" })
    ]);
  });

  it("loads DNS environment variables with precedence over repository variables", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "noVibe" } };
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { owner: { login: "noVibe" }, name: "DnsConf", fork: false } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/variables") {
        return { data: { variables: [{ name: "DNS", value: "cloudflare" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/environments") {
        return { data: { environments: [{ name: "dns" }] } };
      }
      if (route === "GET /repos/{owner}/{repo}/environments/{environment_name}/variables") {
        return { data: { variables: [
          { name: "DNS", value: "NEXTDNS" },
          { name: "DONOR_DNS", value: "37.230.192.51" },
          { name: "REDIRECT", value: GEOHIDE_HOSTS_LIST }
        ] } };
      }
      return { data: {} };
    });

    const result = await loadExistingDnsConfSetup(request, "noVibe", "DnsConf");

    expect(result?.variableEnvironment).toBe("dns");
    expect(result?.variables).toEqual({
      DNS: "NEXTDNS",
      DONOR_DNS: "37.230.192.51",
      REDIRECT: GEOHIDE_HOSTS_LIST
    });
    expect(result?.config).toEqual(expect.objectContaining({
      profiles: [{ clientId: "", authSecret: "", provider: "nextdns", donorDns: "37.230.192.51" }],
      redirects: [GEOHIDE_HOSTS_LIST]
    }));
  });

  it("returns null when the user has no fork", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      throw Object.assign(new Error("Not found"), { status: 404 });
    });

    await expect(loadExistingDnsConfSetup(request, "noVibe", "DnsConf")).resolves.toBeNull();
    expect(request).not.toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/variables",
      expect.anything()
    );
  });

  it("ignores a same-named fork that does not belong to the DnsConf upstream", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { fork: true, parent: { full_name: "someone-else/DnsConf" } } };
      }
      return { data: {} };
    });

    await expect(loadExistingDnsConfSetup(request, "noVibe", "DnsConf")).resolves.toBeNull();
    expect(request).not.toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/variables",
      expect.anything()
    );
  });

  it("ignores a same-named non-fork repository owned by another user", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: false } };
      }
      return { data: {} };
    });

    await expect(loadExistingDnsConfSetup(request, "noVibe", "DnsConf")).resolves.toBeNull();
    expect(request).not.toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/variables",
      expect.anything()
    );
  });

  it("does not hide repository lookup failures as a missing fork", async () => {
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") return { data: { login: "alice" } };
      throw Object.assign(new Error("GitHub unavailable"), { status: 503 });
    });

    await expect(loadExistingDnsConfSetup(request, "noVibe", "DnsConf")).rejects.toThrow("GitHub unavailable");
  });
});

describe("repository helpers", () => {
  it("stars a repository", async () => {
    const request = vi.fn(async () => ({ data: {} }));

    await starRepository(request, "noVibe", "DnsConf");

    expect(request).toHaveBeenCalledWith("PUT /user/starred/{owner}/{repo}", {
      owner: "noVibe",
      repo: "DnsConf",
    });
  });
});
