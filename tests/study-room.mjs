import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {
  ROOM,
  TOPIC,
  cleanText,
  cleanName,
  parsePayload,
  parseServerEvent,
  parseHistory
} = createRequire(import.meta.url)('../docs/study-room.js');

const base = {
  v: 1,
  type: 'chat',
  room: ROOM,
  id: 'message-1234',
  session: 'session-1234',
  name: '  专注的欧拉-123  ',
  status: 'question',
  text: '  一起讨论 Q4(b) 吗？\u0000  ',
  sentAt: 1790000000000
};
const payload = parsePayload(JSON.stringify(base), ROOM);
assert(payload);
assert.equal(payload.name, '专注的欧拉-123');
assert.equal(payload.text, '一起讨论 Q4(b) 吗？');
assert.equal(payload.status, 'question');

for (const invalid of [
  null,
  '{',
  JSON.stringify({...base, v: 2}),
  JSON.stringify({...base, type: 'presence'}),
  JSON.stringify({...base, room: 'different-room'}),
  JSON.stringify({...base, id: 'x'}),
  JSON.stringify({...base, status: '<script>'}),
  JSON.stringify({...base, text: '   '}),
  JSON.stringify({...base, sentAt: 'yesterday'}),
  'x'.repeat(2401)
]) {
  assert.equal(parsePayload(invalid, ROOM), null);
}

assert.equal(cleanText('a\r\nb', 8), 'a\nb');
assert.equal(cleanText('abcdef', 4), 'abcd');
assert.equal(cleanName('  小明\n 同学  '), '小明 同学');
assert.equal(cleanName('12345678901234567').length, 16);

const server = {
  id: 'server-42',
  time: 1790000001,
  event: 'message',
  topic: TOPIC,
  message: JSON.stringify(base)
};
const event = parseServerEvent(server, TOPIC, ROOM);
assert.equal(event.serverId, 'server-42');
assert.equal(event.serverTime, 1790000001000);
assert.deepEqual(event.payload, payload);
assert.equal(parseServerEvent({...server, topic: 'unexpected'}, TOPIC, ROOM), null);
assert.equal(parseServerEvent({...server, event: 'open'}, TOPIC, ROOM), null);

const history = [
  JSON.stringify(server),
  'not json',
  JSON.stringify({...server, id: 'server-ignored', message: '0'.repeat(3000)}),
  JSON.stringify({...server, id: 'server-43', message: JSON.stringify({...base, id: 'message-5678'})})
].join('\n');
assert.deepEqual(parseHistory(history, TOPIC, ROOM).map(item => item.serverId), ['server-42', 'server-43']);

console.log('Study room payload validation, text limits, server timestamps and history filtering passed.');
