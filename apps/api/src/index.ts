/**
 * API entrypoint — apps/api/src/index.ts. SPECS §2.1, §5.6, §7.1, §7.4, §7.5
 * (FR-006, FR-011, AC-005, AC-014, AC-021).
 * loadConfig → createContainer → recover → buildServer → listen → shutdown.
 *
 * Recovery runs before listen, so no client ever sees a stale active
 * response. Fastify's own listen() always logs a free-text "Server listening
 * at <host>:<port>" line; host and port are env values outside the §7.4
 * allowlist, so the entrypoint binds the prepared server directly and logs
 * only the allowlisted recovery record.
 *
 * Close behaviour: fastify.close() always calls server.close() here (no
 * serverFactory). Binding directly leaves Fastify's internal `listening` flag
 * false, which only skips its forceCloseConnections step; on Node ≥ 19
 * server.close() itself closes idle keep-alive sockets (verified on 24.21.0),
 * and open SSE responses are ended earlier by hub.closeAll() (SPECS §7.5).
 */
import type { FastifyInstance } from "fastify";
import { createContainer } from "./bootstrap/container.js";
import { installShutdownSignals, shutdown } from "./bootstrap/shutdown.js";
import { loadConfig } from "./config/env.js";
import { buildServer } from "./http/server.js";

async function listenWithoutAddressLog(
  app: FastifyInstance,
  host: string,
  port: number,
): Promise<void> {
  await app.ready();
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen({ host, port }, () => {
      app.server.off("error", reject);
      resolve();
    });
  });
}

const config = loadConfig(); // fail-fast: exits 1 before any DB or socket (SPECS §7.1)
const container = createContainer(config);
const recoveredResponses = container.recover();
const app = buildServer(container.serverDeps);
app.log.info({ recoveredResponses }, "recovery complete");
installShutdownSignals(() => shutdown(container, app));

try {
  await listenWithoutAddressLog(app, config.host, config.port);
} catch {
  app.log.error({ errorCode: "INTERNAL_ERROR" }, "listen failed");
  await shutdown(container, app);
  process.exit(1);
}
