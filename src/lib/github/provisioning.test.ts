import { describe, expect, it, vi } from "vitest";
import { provisionDnsConfRepository } from "./provisioning";

describe("provisionDnsConfRepository", () => {
  it("forks DnsConf, uploads encrypted secrets, upserts variables, and dispatches the workflow", async () => {
    let forkExists = false;
    const request = vi.fn(async (route: string) => {
      if (route === "GET /user") {
        return { data: { login: "alice" } };
      }
      if (route === "GET /repos/{owner}/{repo}") {
        if (!forkExists) {
          throw Object.assign(new Error("Not found"), { status: 404 });
        }
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true } };
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
      return { data: {} };
    });
    const encryptSecret = vi.fn(async (value: string) => `encrypted:${value}`);

    const result = await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", BLOCK: "https://example.com/list", REDIRECT: "", EXCLUDE_REDIRECT: "" }
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
      "POST /repos/{owner}/{repo}/actions/variables",
      expect.objectContaining({ name: "DNS", value: "cloudflare" })
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
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/secrets/public-key") {
        return { data: { key: "public-key", key_id: "key-id" } };
      }
      if (route === "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs") {
        return { data: { workflow_runs: [{ id: 1, html_url: "https://github.com/alice/DnsConf/actions/runs/1" }] } };
      }
      return { data: {} };
    });

    const result = await provisionDnsConfRepository({
      sourceOwner: "noVibe",
      sourceRepo: "DnsConf",
      workflowFileName: "github_action.yml",
      payload: {
        secrets: { CLIENT_ID: "client", AUTH_SECRET: "secret" },
        variables: { DNS: "cloudflare", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    });

    expect(result.repository).toEqual({ owner: "alice", repo: "DnsConf" });
    expect(request).not.toHaveBeenCalledWith("POST /repos/{owner}/{repo}/forks", expect.anything());
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
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true } };
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
      if (
        route === "POST /repos/{owner}/{repo}/actions/variables" &&
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
        variables: { DNS: "cloudflare", BLOCK: "", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    });

    expect(request).toHaveBeenCalledWith(
      "PATCH /repos/{owner}/{repo}/actions/variables/{name}",
      {
        owner: "alice",
        repo: "DnsConf",
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
        return { data: { owner: { login: "alice" }, name: "DnsConf", fork: true } };
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
      if (
        route === "POST /repos/{owner}/{repo}/actions/variables" &&
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
        variables: { DNS: "cloudflare", BLOCK: "https://example.com/list", REDIRECT: "", EXCLUDE_REDIRECT: "" }
      },
      request,
      encryptSecret: async (value) => `encrypted:${value}`
    });

    expect(request).toHaveBeenCalledWith(
      "PATCH /repos/{owner}/{repo}/actions/variables/{name}",
      {
        owner: "alice",
        repo: "DnsConf",
        name: "BLOCK",
        value: "https://example.com/list"
      }
    );
  });
});
