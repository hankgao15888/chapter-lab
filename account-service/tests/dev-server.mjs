import {createServer} from 'node:http';
import worker from '../worker/index.js';
import {FakeD1} from './fake-d1.mjs';

const port = Number(process.argv[2] || 8787);
const db = new FakeD1();

const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, {
    method: incoming.method,
    headers: incoming.headers,
    body
  });
  const response = await worker.fetch(request, {DB: db});
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Chapter Lab mock account API listening on http://127.0.0.1:${port}`);
});
