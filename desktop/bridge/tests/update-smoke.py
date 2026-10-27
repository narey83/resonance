#!/usr/bin/env python3
"""Real-engine signed update/rollback smoke test. Isolated temporary cache and pairing only."""
import base64, json, os, pathlib, socket, subprocess, tempfile, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone, timedelta
root=pathlib.Path(__file__).resolve().parents[1]
go=os.environ.get('GO','go')
def wait_for(predicate, message, timeout=60):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  try:
   value=predicate()
   if value:return value
  except (OSError, ValueError, urllib.error.URLError):pass
  time.sleep(.2)
 raise RuntimeError(message)
with tempfile.TemporaryDirectory(prefix='resonance-update-smoke-') as directory:
 temp=pathlib.Path(directory);cache=temp/'cache';cache.mkdir();releases=temp/'releases';releases.mkdir()
 publisher=temp/'publisher'
 subprocess.run([go,'build','-o',str(publisher),'./cmd/helper-release'],cwd=root,check=True)
 key=temp/'release.key';subprocess.run([str(publisher),'--generate-key','--key',str(key)],check=True)
 public=key.with_suffix('.key.pub').read_text()
 def build(version,path):
  subprocess.run([go,'build','-ldflags',f'-X main.helperVersion={version} -X main.updatePublicKey={public}','-o',str(path),'.'],cwd=root,env={**os.environ,'CGO_ENABLED':'0'},check=True)
 old=temp/'original';new=temp/'new';build('0.3.0',old);build('0.3.1',new)
 def publish(path,version):
  subprocess.run([str(publisher),'--key',str(key),'--binary',str(path),'--version',version,'--os','linux','--arch','amd64','--output',str(releases)],check=True)
 publish(new,'0.3.1')
 token='a'*64
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   if self.headers.get('X-Resonance-Link-Token')!=token:self.send_error(401);return
   if self.path.endswith('/sync'):body=b'{"revision":"test","job":null}'
   elif self.path.endswith('/updates/linux/amd64'):body=(releases/'linux-amd64.json').read_bytes()
   elif '/binary?sha256=' in self.path:
    hash=self.path.split('sha256=')[-1]
    if len(hash)!=64 or any(c not in 'abcdef0123456789' for c in hash):self.send_error(400);return
    body=(releases/(hash+'.bin')).read_bytes()
   else:self.send_error(404);return
   self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 instance=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=instance.serve_forever,daemon=True).start()
 (cache/'connection.json').write_text(json.dumps({'schemaVersion':1,'serverUrl':f'http://127.0.0.1:{instance.server_port}/api/v0/analysis/pioneer-link/sync','token':token,'expires':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()}))
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 def status():
  with urllib.request.urlopen(base+'/api/status',timeout=2) as response:return json.load(response)
 log=(temp/'engine.log').open('w+')
 helper=subprocess.Popen([str(old),'--headless','--no-open','--cache',str(cache),'--port',str(port)],stdout=log,stderr=log)
 try:
  wait_for(lambda:status().get('version')=='0.3.1','signed engine did not install and restart')
  wait_for(lambda:(cache/'last-good-release.json').exists(),'new engine failed startup health check')
  if helper.poll() is not None:raise RuntimeError('supervisor exited during update')
  broken=temp/'broken';broken.write_text('#!/bin/sh\nexit 1\n');publish(broken,'0.3.2')
  request=urllib.request.Request(base+'/api/desktop/check-update',data=b'',headers={'X-Resonance-Link':'1'},method='POST')
  with urllib.request.urlopen(request,timeout=2) as response:response.read()
  wait_for(lambda:(cache/'rejected-release.json').exists(),'failed release was not rejected')
  wait_for(lambda:status().get('version')=='0.3.1','previous working engine was not restored')
  if helper.poll() is not None:raise RuntimeError('supervisor exited during rollback')
  def rejected_status():
   with urllib.request.urlopen(base+'/api/desktop',timeout=2) as response:
    return json.load(response)['update']['status'].startswith('Previous update failed')
  wait_for(rejected_status,'failed release was not suppressed',timeout=20)
  time.sleep(2)
  if not (cache/'connection.json').exists():raise RuntimeError('pairing was lost')
  print(json.dumps({'signedUpdate':'passed','restart':'passed','startupHealth':'passed','failedUpdateRollback':'passed','pairingPreserved':'passed'}))
 except Exception:
  log.flush();print((temp/'engine.log').read_text());raise
 finally:
  helper.terminate()
  try:helper.wait(timeout=20)
  except subprocess.TimeoutExpired:helper.kill();helper.wait()
  instance.shutdown();log.close()
