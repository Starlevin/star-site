import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const js=fs.readFileSync(path.join(root,'public/main.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
test('分享邀请链接入口与同域 WSS 连接',()=>{
  assert.match(html,/id="shareBtn"/);
  assert.match(js,/URLSearchParams\(location\.search\)\.get\('room'\)/);
  assert.match(js,/navigator\.share/);
  assert.match(js,/location\.protocol==='https:'\?'wss':'ws'/);
});
test('Render 端口与健康检查',()=>{
  assert.match(server,/process\.env\.PORT/);
  assert.match(server,/listen\(PORT,'0\.0\.0\.0'/);
  assert.match(server,/uptimeSeconds/);
  assert.match(server,/MAX_ROOMS/);
});
