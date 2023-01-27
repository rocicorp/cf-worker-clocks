export interface Env {
  clocksTestDO: DurableObjectNamespace;
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const resp = await innerFetch(request, env, ctx);
    const respWithAllowAllCORS = new Response(resp.body, resp);
    respWithAllowAllCORS.headers.set("Access-Control-Allow-Origin", "*");
    return respWithAllowAllCORS;
  },
};

async function innerFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const forward = () => {
    return env.clocksTestDO
      .get(env.clocksTestDO.idFromName("clock-tests-singleton"))
      .fetch(request);
  };
  switch (url.pathname) {
    case "/worker-post":
      return handlePost(request, ctx);
    case "/do-post":
    case "/do-websocket":
      return forward();
  }
  return new Response("Not Found", { status: 404 });
}

class ClocksTestDO implements DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/do-post":
        return handlePost(request);
      case "/do-websocket":
        return handleWebSocketConnect(request);
    }
    return new Response("Not Found", { status: 404 });
  }
}

async function handlePost(
  request: Request,
  ctx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const work = parseInt(url.searchParams.get("work") ?? "0");
  const [i, clientTimestamp] = await request.json<number[]>();
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
  return new Response(JSON.stringify([i, clientTimestamp, Date.now()]));
}

async function handleWebSocketConnect(request: Request): Promise<Response> {
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
    const [i, clientTimestamp] = JSON.parse(event.data.toString());
    ws.send(JSON.stringify([i, clientTimestamp, Date.now()]));
    doWork(work);
  });
  return new Response(null, { status: 101, webSocket: pair[0] });
}

function doWork(work: number) {
  let result = 1;
  for (let i = 0; i < work; i++) {
    for (let j = 0; j < work; j++) {
      result = result + i * j + crypto.randomUUID().length;
    }
  }
  return result;
}

export { worker as default, ClocksTestDO };
