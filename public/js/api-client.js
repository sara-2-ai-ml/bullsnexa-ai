"use strict";

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "The request could not be completed.");
    error.code = data?.error?.code || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = Object.freeze({
  config: () => request("/api/config"),
  formOptions: () => request("/api/form-options"),
  extract: (text) => request("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }),
  createRun: (brief) => request("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief }),
  }),
  listRuns: () => request("/api/runs"),
  getRun: (runId) => request("/api/runs/" + encodeURIComponent(runId)),
  deleteRun: (runId) => request("/api/runs/" + encodeURIComponent(runId), { method: "DELETE" }),
  decideApproval: (runId, payload) => request("/api/runs/" + encodeURIComponent(runId) + "/approval", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }),
  logout: () => request("/api/logout", { method: "POST" }),
});
