import { spawn } from "node:child_process";

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4173/health");
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The isolated E2E server did not become ready.");
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = spawn(process.execPath, ["scripts/e2e-server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, AGENT_PROVIDER: "simulated" },
    stdio: "inherit",
    windowsHide: true,
  });
  const earlyExit = new Promise<never>((_, reject) => {
    server.once("exit", (code) => reject(new Error(`E2E server exited before readiness (${code ?? "signal"}).`)));
  });
  await Promise.race([waitForServer(), earlyExit]);

  return async () => {
    if (server.exitCode !== null) return;
    server.kill();
    await Promise.race([
      new Promise<void>((resolve) => server.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  };
}
