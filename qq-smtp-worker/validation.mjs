export const MAX_BYTES = 262144;
export function address(value) {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value);
}
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['request_id', 'to', 'subject', 'text'].includes(k))) throw Error('INVALID_REQUEST');
  if (typeof input.request_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{15,127}$/.test(input.request_id)) throw Error('INVALID_REQUEST_ID');
  if (!Array.isArray(input.to) || input.to.length < 1 || input.to.length > 10 || input.to.some(x => !address(x)) || new Set(input.to.map(x => x.toLowerCase())).size !== input.to.length) throw Error('INVALID_RECIPIENTS');
  if (typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 200 || /[\r\n\0]/.test(input.subject)) throw Error('INVALID_SUBJECT');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 50000 || /\0/.test(input.text) || new TextEncoder().encode(input.text).length > 150000) throw Error('INVALID_TEXT');
  return { request_id: input.request_id, to: input.to, subject: input.subject, text: input.text };
}
export async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Error('JSON_REQUIRED');
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw Error('REQUEST_TOO_LARGE');
  const reader = request.body?.getReader(); if (!reader) throw Error('INVALID_REQUEST');
  const chunks = []; let size = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw Error('REQUEST_TOO_LARGE'); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); } catch { throw Error('INVALID_JSON'); }
}
export async function fingerprint(input) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
}
