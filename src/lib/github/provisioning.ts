import { Octokit } from "@octokit/core";
import type { DnsConfPayload } from "@/domain/dnsconf-config";
import { encryptGitHubSecret } from "./crypto";

type Request = (route: string, parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>;

type EncryptSecret = (value: string, publicKey: string) => Promise<string>;

export type ProvisionStep = "fork" | "secrets" | "dispatch";

export type ProvisionDnsConfInput = {
  sourceOwner: string;
  sourceRepo: string;
  workflowFileName: string;
  payload: DnsConfPayload;
  request: Request;
  encryptSecret?: EncryptSecret;
  onStep?: (step: ProvisionStep) => Promise<void> | void;
};

export type ProvisionResult = {
  repository: {
    owner: string;
    repo: string;
  };
  workflowRunUrl?: string;
  workflowRunId?: number;
};

type RepoResponse = {
  owner?: { login?: string };
  name?: string;
  fork?: boolean;
};

type PublicKeyResponse = {
  key: string;
  key_id: string;
};

const POLL_RETRIES = 12;
const POLL_INTERVAL_MS = 5000;

export function createGitHubRequest(token: string): Request {
  const octokit = new Octokit({ auth: token });
  const request = octokit.request as unknown as Request;
  return (route, parameters) => request(route, parameters);
}

export async function provisionDnsConfRepository({
  sourceOwner,
  sourceRepo,
  workflowFileName,
  payload,
  request,
  encryptSecret = encryptGitHubSecret,
  onStep
}: ProvisionDnsConfInput): Promise<ProvisionResult> {
  const user = await getAuthenticatedUser(request);
  const { owner, repo } = await ensureFork(request, sourceOwner, sourceRepo, user);
  await onStep?.("fork");

  const publicKey = await request("GET /repos/{owner}/{repo}/actions/secrets/public-key", {
    owner,
    repo
  });
  const { key, key_id: keyId } = publicKey.data as PublicKeyResponse;

  await Promise.all(
    Object.entries(payload.secrets).map(async ([name, value]) => {
      const encrypted = await encryptSecret(value, key);

      await request("PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}", {
        owner,
        repo,
        secret_name: name,
        encrypted_value: encrypted,
        key_id: keyId
      });
    })
  );

  for (const [name, value] of Object.entries(payload.variables)) {
    if (value) {
      await upsertVariable(request, owner, repo, name, value);
    }
  }

  await enableActionsIfDisabled(request, owner, repo);
  await onStep?.("secrets");

  await request("PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable", {
    owner,
    repo,
    workflow_id: workflowFileName
  });

  await request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
    owner,
    repo,
    workflow_id: workflowFileName,
    ref: "main"
  });

  const { workflowRunUrl, workflowRunId } = await fetchWorkflowRun(request, owner, repo, workflowFileName);

  if (workflowRunId) {
    await waitForWorkflowRunCompletion(request, owner, repo, workflowRunId);
  }

  await onStep?.("dispatch");

  return { repository: { owner, repo }, workflowRunUrl, workflowRunId };
}

async function getAuthenticatedUser(request: Request): Promise<string> {
  const response = await request("GET /user");
  const data = response.data as { login: string };
  return data.login;
}

async function findExistingFork(
  request: Request,
  user: string,
  repo: string
): Promise<{ owner: string; repo: string } | null> {
  try {
    const response = await request("GET /repos/{owner}/{repo}", { owner: user, repo });
    const data = response.data as RepoResponse;
    if (data.fork) {
      return { owner: user, repo };
    }
  } catch {
  }
  return null;
}

async function ensureFork(
  request: Request,
  sourceOwner: string,
  sourceRepo: string,
  user: string
): Promise<{ owner: string; repo: string }> {
  const existing = await findExistingFork(request, user, sourceRepo);
  if (existing) {
    return existing;
  }

  try {
    await request("POST /repos/{owner}/{repo}/forks", {
      owner: sourceOwner,
      repo: sourceRepo
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      const found = await findExistingFork(request, user, sourceRepo);
      if (found) {
        return found;
      }
    }
    throw error;
  }

  return await waitForFork(request, user, sourceRepo);
}

async function waitForFork(
  request: Request,
  user: string,
  repo: string
): Promise<{ owner: string; repo: string }> {
  for (let i = 0; i < POLL_RETRIES; i++) {
    try {
      const response = await request("GET /repos/{owner}/{repo}", { owner: user, repo });
      const data = response.data as RepoResponse;
      if (data.fork) {
        return { owner: user, repo };
      }
    } catch {
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Fork creation timed out. The fork may still be in progress on GitHub.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertVariable(
  request: Request,
  owner: string,
  repo: string,
  name: string,
  value: string
) {
  try {
    await request("POST /repos/{owner}/{repo}/actions/variables", {
      owner,
      repo,
      name,
      value
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    await request("PATCH /repos/{owner}/{repo}/actions/variables/{name}", {
      owner,
      repo,
      name,
      value
    });
  }
}

const DISPATCH_POLL_RETRIES = 10;
const DISPATCH_POLL_INTERVAL_MS = 2000;

async function fetchWorkflowRun(
  request: Request,
  owner: string,
  repo: string,
  workflowFileName: string
): Promise<{ workflowRunUrl?: string; workflowRunId?: number }> {
  for (let i = 0; i < DISPATCH_POLL_RETRIES; i++) {
    try {
      const response = await request(
        "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
        { owner, repo, workflow_id: workflowFileName, per_page: 1 }
      );
      const data = response.data as { workflow_runs?: Array<{ id: number; html_url?: string }> };
      const run = data.workflow_runs?.[0];
      if (run?.html_url) {
        return { workflowRunUrl: run.html_url, workflowRunId: run.id };
      }
    } catch {
      // retry
    }
    await sleep(DISPATCH_POLL_INTERVAL_MS);
  }
  return {};
}

const WORKFLOW_COMPLETION_RETRIES = 300;
const WORKFLOW_COMPLETION_INTERVAL_MS = 10000;

async function waitForWorkflowRunCompletion(
  request: Request,
  owner: string,
  repo: string,
  runId: number
): Promise<void> {
  for (let i = 0; i < WORKFLOW_COMPLETION_RETRIES; i++) {
    try {
      const response = await request("GET /repos/{owner}/{repo}/actions/runs/{run_id}", {
        owner,
        repo,
        run_id: runId
      });
      const data = response.data as { status?: string; conclusion?: string };
      if (data.status === "completed") {
        if (data.conclusion === "success") return;
        throw new Error(`Workflow run finished with conclusion: ${data.conclusion}`);
      }
    } catch (error) {
      // re-throw if it's a provisioning error, retry on network issues
      if (error instanceof Error && error.message.startsWith("Workflow run")) {
        throw error;
      }
    }
    await sleep(WORKFLOW_COMPLETION_INTERVAL_MS);
  }
  // Timeout — still mark as done (the workflow might still be running)
}

async function enableActionsIfDisabled(request: Request, owner: string, repo: string): Promise<void> {
  try {
    await request("PUT /repos/{owner}/{repo}/actions/permissions", {
      owner,
      repo,
      enabled: true,
      allowed_actions: "all"
    });
  } catch {
    // non-critical
  }
}

export async function isForkBehind(
  request: Request,
  owner: string,
  repo: string,
  upstreamOwner: string,
  upstreamRepo: string
): Promise<boolean> {
  try {
    const response = await request("GET /repos/{owner}/{repo}/compare/{basehead}", {
      owner,
      repo,
      basehead: `main...${upstreamOwner}:${upstreamRepo}:main`
    });
    const data = response.data as { behind_by?: number };
    return (data.behind_by ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function syncFork(
  request: Request,
  owner: string,
  repo: string
): Promise<void> {
  await request("POST /repos/{owner}/{repo}/merge-upstream", {
    owner,
    repo,
    branch: "main"
  });
}

export async function starRepository(
  request: Request,
  owner: string,
  repo: string
): Promise<void> {
  await request("PUT /user/starred/{owner}/{repo}", { owner, repo });
}

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    status?: number;
    response?: { status?: number };
    message?: string;
  };
  const status = candidate.status ?? candidate.response?.status;
  const message = candidate.message?.toLowerCase() ?? "";

  return status === 409 || (status === 422 && message.includes("already"));
}
