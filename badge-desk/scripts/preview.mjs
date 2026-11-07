import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {Readable} from "node:stream";
import {DatabaseSync} from "node:sqlite";
import worker from "../../functions/_shared/badge-desk.generated.js";

const db = new DatabaseSync(":memory:");
for (const migration of ["0000_checkouts.sql", "0001_checkout_owner.sql", "0002_badge_rate_limits.sql"]) {
  db.exec(readFileSync(new URL("../drizzle/" + migration, import.meta.url), "utf8"));
}
const files = new Map();
function prepare(sql, values = []) {
  const statement = db.prepare(sql);
  return {
    bind: (...next) => prepare(sql, next),
    all: async () => ({results: statement.all(...values)}),
    first: async () => statement.get(...values) ?? null,
    run: async () => ({meta: statement.run(...values)})
  };
}
const env = {
  DB: {prepare},
  BUCKET: {
    put: async (key, body) => files.set(key, body),
    delete: async key => files.delete(key),
    get: async key => files.has(key) ? {body:files.get(key)} : null
  }
};
const portArg = process.argv.indexOf("--port");
const port = Number(process.env.PORT || (portArg >= 0 ? process.argv[portArg+1] : 3000));
createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers(incoming.headers);
    headers.set("CF-Connecting-IP", "127.0.0.1");
    const base = "http://" + incoming.headers.host;
    const request = new Request(base + incoming.url, {
      headers,
      method:incoming.method,
      ...(incoming.method === "POST" && {body:Readable.toWeb(incoming), duplex:"half"})
    });
    // This in-memory preview is not deployed. Staff pages remain locked unless
    // explicitly enabled for a local-only preview.
    const result = await worker.fetch(request, env, process.env.BADGE_LOCAL_ADMIN === "1");
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(500).end("Preview request failed");
  }
}).listen(port, "0.0.0.0");
