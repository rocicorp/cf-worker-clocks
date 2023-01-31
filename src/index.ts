import indexHTML from "index.html";

export interface Env {
  clocksTestDO: DurableObjectNamespace;
  clockWorker: Fetcher;
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    let workerID = globalThis.workerID;
    if (workerID === undefined) {
      workerID = crypto.randomUUID();
      globalThis.workerID = workerID;
    }
    console.log(workerID, "worker clockWorker", env.clockWorker);
    const url = new URL(request.url);
    const forward = () => {
      return env.clocksTestDO
        .get(env.clocksTestDO.idFromName("clock-tests-singleton"))
        .fetch(request);
    };
    switch (url.pathname) {
      case "/":
        return new Response(indexHTML, {
          headers: {
            "content-type": "text/html;charset=UTF-8",
          },
        });
      case "/now":
        return new Response(JSON.stringify({ id: workerID, now: Date.now() }));
      case "/worker-post":
        return handlePost(request, workerID, Date.now(), ctx);
      case "/do-post":
      case "/do-worker-post":
      case "/do-worker-internet-post":
      case "/do-websocket":
        return forward();
    }
    return new Response("Not Found", { status: 404 });
  },
};

class ClocksTestDO implements DurableObject {
  private readonly _doID: string;
  private readonly _env: Env;

  constructor(_state: DurableObjectState, env: Env) {
    this._env = env;
    this._doID = crypto.randomUUID();
  }

  async fetch(request: Request): Promise<Response> {
    console.log(this._doID, "DO clockWorker", this._env.clockWorker);
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/do-worker-post": {
        const { id, now } = await (
          await this._env.clockWorker.fetch("https://unused/now")
        ).json<{ id: string; now: number }>();
        return handlePost(request, this._doID + "/" + id, now);
      }
      case "/do-worker-internet-post": {
        const response = await fetch(
          "https://cf-worker-clocks-test-w-service-bindings.replicache.workers.dev/now"
        );
        console.log(response.status, response.statusText);
        if (response.status !== 200) {
          return new Response(response.statusText, response);
        }
        const { id, now } = await response.json<{ id: string; now: number }>();
        return handlePost(request, this._doID + "/" + id, now);
      }
      case "/do-post":
        return handlePost(request, this._doID, Date.now());
      case "/do-websocket":
        return handleWebSocketConnect(request, this._doID);
    }
    return new Response("Not Found", { status: 404 });
  }
}

async function handlePost(
  request: Request,
  serverID: string,
  now: number,
  ctx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const work = parseInt(url.searchParams.get("work") ?? "0");
  const { i, pageTimestamp } = await request.json<{
    i: number;
    pageTimestamp: number;
  }>();
  if (ctx) {
    const promise = new Promise((resolve) => {
      setTimeout(() => {
        doWork(work);
        resolve(undefined);
      }, 1);
    });
    ctx.waitUntil(promise);
  } else {
    setTimeout(() => doWork(work), 1);
  }
  return new Response(createResponseBody(serverID, i, pageTimestamp, now));
}

async function handleWebSocketConnect(
  request: Request,
  serverID: string
): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected websocket", { status: 400 });
  }
  const url = new URL(request.url);
  const pair = new WebSocketPair();
  const ws = pair[1];
  const work = parseInt(url.searchParams.get("work") ?? "0");
  ws.accept();
  ws.send("connected");
  ws.addEventListener("message", async (event) => {
    const { i, pageTimestamp } = JSON.parse(event.data.toString());
    ws.send(createResponseBody(serverID, i, pageTimestamp, Date.now()));
    setTimeout(() => doWork(work), 1);
  });
  return new Response(null, { status: 101, webSocket: pair[0] });
}

function createResponseBody(
  serverID: string,
  i: number,
  pageTimestamp: number,
  serverTimestamp: number
) {
  return JSON.stringify({ serverID, i, pageTimestamp, serverTimestamp });
}

function doWork(work: number) {
  let result = 1;
  for (let i = 0; i < work; i++) {
    result = result + i * i + crypto.randomUUID().length;
  }
  return result;
}

export { worker as default, ClocksTestDO };
