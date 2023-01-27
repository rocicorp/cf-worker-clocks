import indexHTML from "index.html";

export interface Env {
  clocksTestDO: DurableObjectNamespace;
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
      case "/worker-post":
        return handlePost(request, workerID, ctx);
      case "/do-post":
      case "/do-websocket":
        return forward();
    }
    return new Response("Not Found", { status: 404 });
  },
};

class ClocksTestDO implements DurableObject {
  private readonly _doID: string;

  constructor() {
    this._doID = crypto.randomUUID();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/do-post":
        return handlePost(request, this._doID);
      case "/do-websocket":
        return handleWebSocketConnect(request, this._doID);
    }
    return new Response("Not Found", { status: 404 });
  }
}

async function handlePost(
  request: Request,
  serverID: string,
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
  return new Response(
    createResponseBody(serverID, i, pageTimestamp, Date.now())
  );
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
