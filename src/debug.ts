import { createServer as createHttpServer, type Server, type ServerResponse } from "node:http";

export type DebugDirection = "received" | "sent" | "endpoint" | "returned" | "tool" | "error";

export interface DebugEvent {
  seq: number;
  at: string;
  sessionId: string;
  direction: DebugDirection;
  label: string;
  model?: string;
  payload?: unknown;
  ms?: number;
}

const enabled = Number(process.env.PI_DELEGATE_DEBUG_PORT || 0) > 0;
const limit = Math.max(10, Number(process.env.PI_DELEGATE_DEBUG_HISTORY || 100) || 100);
const events: DebugEvent[] = [];
const clients = new Set<ServerResponse>();
let seq = 0;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/authorization|cookie|api[-_]?key|token|secret/i.test(key)) out[key] = "[redacted]";
    else out[key] = scrub(item);
  }
  return out;
}

export function debugEvent(event: Omit<DebugEvent, "seq" | "at">): void {
  if (!enabled) return;
  const entry: DebugEvent = { seq: ++seq, at: new Date().toISOString(), ...event, payload: scrub(event.payload) };
  events.push(entry);
  while (events.length > limit) events.shift();
  const line = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of clients) client.write(line);
}

function html(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>pi-delegate live debug</title>
<style>
body{margin:0;background:#101214;color:#e8eaed;font:14px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}header{position:sticky;top:0;background:#171a1d;padding:12px 16px;border-bottom:1px solid #333;display:flex;gap:14px;align-items:center}#dot{color:#7ee787}button{margin-left:auto;background:#25292e;color:#e8eaed;border:1px solid #444;border-radius:4px;padding:5px 9px}main{padding:12px 16px}.event{border-bottom:1px solid #292d31;padding:10px 0}.meta{color:#9da7b3}.received{color:#79c0ff}.sent{color:#d2a8ff}.endpoint{color:#7ee787}.returned{color:#ffa657}.error{color:#ff7b72}.tool{color:#e3b341}pre{white-space:pre-wrap;word-break:break-word;margin:6px 0 0;color:#d7dde5}.empty{color:#7d8590;padding-top:20px}</style></head>
<body><header><strong>pi-delegate live debug</strong><span id="dot">● connected</span><span>memory only · last ${limit}</span><button id="clear">clear screen</button></header><main id="feed"><div class="empty">waiting for activity…</div></main>
<script>
const feed=document.getElementById('feed'); const dot=document.getElementById('dot');
function render(e){document.querySelector('.empty')?.remove();const d=document.createElement('div');d.className='event';const p=e.payload===undefined?'':JSON.stringify(e.payload,null,2);d.innerHTML='<div class="meta">'+e.at+' · '+e.sessionId+(e.model?' · '+e.model:'')+(e.ms!==undefined?' · '+e.ms+'ms':'')+'</div><div class="'+e.direction+'">'+e.direction.toUpperCase()+' · '+e.label+'</div>'+(p?'<pre></pre>':'');if(p)d.querySelector('pre').textContent=p;feed.prepend(d)}
fetch('/debug/pi-delegate/snapshot').then(r=>r.json()).then(xs=>xs.forEach(render));
const es=new EventSource('/debug/pi-delegate/events');es.onopen=()=>{dot.textContent='● connected';dot.style.color='#7ee787'};es.onerror=()=>{dot.textContent='● reconnecting';dot.style.color='#ff7b72'};es.onmessage=x=>render(JSON.parse(x.data));
document.getElementById('clear').onclick=()=>{feed.innerHTML='<div class="empty">screen cleared · waiting for activity…</div>'};
</script></body></html>`;
}

export function startDebugViewer(port: number, host = "127.0.0.1"): Server {
  const server = createHttpServer((req, res) => {
    const path = new URL(req.url || "/", "http://localhost").pathname;
    if (path === "/" || path === "/debug/pi-delegate" || path === "/debug/pi-delegate/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html());
      return;
    }
    if (path.endsWith("/snapshot")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(events));
      return;
    }
    if (path.endsWith("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    res.writeHead(404).end("not found");
  });
  server.listen(port, host);
  return server;
}

export function startConfiguredDebugViewer(): Server | undefined {
  const port = Number(process.env.PI_DELEGATE_DEBUG_PORT || 0);
  if (!Number.isFinite(port) || port <= 0) return undefined;
  return startDebugViewer(port);
}
