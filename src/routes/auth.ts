import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { SESSION_COOKIE, type DemoAuth } from "../http/auth.js";

export interface AuthRoutesOptions {
  readonly auth: DemoAuth;
}

const LoginSchema = z
  .object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) })
  .strict();

function cookie(request: FastifyRequest, value: string, maxAgeSeconds: number): string {
  // Secure only over HTTPS (behind a trusted proxy request.protocol reflects it).
  const secure = request.protocol === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function denied(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(401).send({
    error: { code: "INVALID_CREDENTIALS", message: "Wrong username or password" },
    requestId: request.id,
  });
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { auth }) => {
  app.post("/api/login", { bodyLimit: 1024 }, async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return denied(request, reply);
    if (!auth.verifyCredentials(parsed.data.username, parsed.data.password)) {
      return denied(request, reply);
    }
    return reply
      .header("set-cookie", cookie(request, auth.issueToken(), auth.sessionMaxAgeSeconds))
      .header("cache-control", "no-store")
      .send({ ok: true });
  });

  app.post("/api/logout", async (request, reply) =>
    reply.header("set-cookie", cookie(request, "", 0)).header("cache-control", "no-store").send({ ok: true }),
  );
};
