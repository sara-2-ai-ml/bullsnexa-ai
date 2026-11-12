import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { loggerOptions } from "../src/observability/logger.js";

describe("logging security", () => {
  it("redacts common secret fields", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = pino(loggerOptions, destination);

    logger.info({
      authorization: "Bearer secret-token",
      apiKey: "api-secret",
      password: "password-secret",
    });

    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("api-secret");
    expect(output).not.toContain("password-secret");
    expect(output).toContain("[REDACTED]");
  });
});
