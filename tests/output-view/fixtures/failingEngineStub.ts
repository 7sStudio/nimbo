// failingEngineStub: query engines whose one behaviour is to fail with `cause`, for the failures no real engine gives on
// demand (a download that does not finish, a table that will not drop). They answer no query: every answer the viewer
// shows comes from query-json's and query-sql's real engines (engines.ts).
import type { EngineResult, QueryEngines } from "@jsnb/output-view/model";

export function failingEngineStub(cause: unknown): Required<QueryEngines> {
  const fail = (): Promise<never> =>
    Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
  const unavailable: EngineResult<never> = {
    ok: false,
    error: { kind: "unavailable", message: String(cause) },
  };
  return {
    jsonpath: { id: "jsonpath", mode: "select", load: fail, compile: () => unavailable },
    jq: { id: "jq", mode: "transform", load: fail, compile: () => unavailable },
    sql: { load: fail, register: fail, query: fail, exportAll: fail, drop: fail },
    chips: {
      toJsonPath: () => {
        throw cause instanceof Error ? cause : new Error(String(cause));
      },
      fromJsonPath: () => undefined,
    },
  };
}
