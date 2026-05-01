import process from "node:process";

type Command =
  | "refresh"
  | "enrich"
  | "finalize"
  | "ingest-doc"
  | "purge-source"
  | "backfill-source"
  | "backfill-llm";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function buildUrl(baseUrl: string, path: string, params: URLSearchParams) {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.search = params.toString();
  return url.toString();
}

async function callAdmin(path: string, params: URLSearchParams) {
  const baseUrl = requireEnv("BASE_URL");
  const adminSecret = requireEnv("ADMIN_SECRET");
  const response = await fetch(buildUrl(baseUrl, path, params), {
    headers: {
      Authorization: `Bearer ${adminSecret}`,
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const [command, ...args] = process.argv.slice(2) as [Command, ...string[]];
  if (!command) {
    throw new Error("command is required");
  }

  if (command === "refresh") {
    console.log(JSON.stringify(await callAdmin("/api/refresh", new URLSearchParams()), null, 2));
    return;
  }

  if (command === "enrich") {
    const batch = args[0] || "200";
    const repeat = Number(args[1] || "1");
    for (let i = 0; i < repeat; i += 1) {
      const result = await callAdmin("/api/enrich", new URLSearchParams({ batch }));
      console.log(JSON.stringify(result, null, 2));
      if ((result as any).complete) break;
    }
    return;
  }

  if (command === "finalize") {
    console.log(JSON.stringify(await callAdmin("/api/finalize", new URLSearchParams()), null, 2));
    return;
  }

  if (command === "ingest-doc") {
    const doc = args[0];
    if (!doc) throw new Error("doc id is required");
    const limit = args[1] || "100";
    console.log(JSON.stringify(await callAdmin("/api/ingest", new URLSearchParams({ doc, limit })), null, 2));
    return;
  }

  if (command === "backfill-source") {
    const doc = args[0];
    if (!doc) throw new Error("doc id is required");
    const offset = args[1] || "0";
    const limit = args[2] || "0";
    const llm = args[3] || "1";
    console.log(JSON.stringify(await callAdmin("/api/backfill-source", new URLSearchParams({ doc, offset, limit, llm })), null, 2));
    return;
  }

  if (command === "purge-source") {
    const doc = args[0];
    if (!doc) throw new Error("doc id is required");
    console.log(JSON.stringify(await callAdmin("/api/purge-source", new URLSearchParams({ doc })), null, 2));
    return;
  }

  if (command === "backfill-llm") {
    const doc = args[0];
    if (!doc) throw new Error("doc id is required");
    const limit = args[1] || "10";
    console.log(JSON.stringify(await callAdmin("/api/backfill-llm", new URLSearchParams({ doc, limit })), null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
