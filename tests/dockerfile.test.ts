import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");

/**
 * Static guard only. It does NOT prove the image builds or runs; Docker
 * runtime verification is a separate manual step (see README).
 */
describe("Dockerfile static checks", () => {
  const dockerfile = read("Dockerfile");
  const runtime = dockerfile.slice(dockerfile.lastIndexOf("FROM node:24"));

  it("ships what the app reads at runtime: policies and the UI", () => {
    expect(runtime).toMatch(/COPY .*data \.\/data/);
    expect(runtime).toMatch(/COPY .*public \.\/public/);
    expect(runtime).toMatch(/COPY .*\/app\/dist/);
  });

  it("runs as the non-root node user with a writable database directory", () => {
    expect(runtime).toMatch(/\nUSER node\n/);
    expect(runtime).toMatch(/mkdir -p \/app\/var && chown node:node \/app\/var/);
    expect(runtime).toMatch(/DATABASE_PATH=\/app\/var\//);
    expect(runtime.indexOf("chown node:node /app/var")).toBeLessThan(runtime.indexOf("USER node"));
  });

  it("never copies secrets or sets credentials in the image", () => {
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    expect(dockerfile).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(dockerfile).not.toMatch(/sk-ant-/);
  });

  it("starts the compiled server on the exposed port", () => {
    expect(runtime).toMatch(/EXPOSE 3000/);
    expect(runtime).toMatch(/CMD \["node", "dist\/server\.js"\]/);
  });
});
