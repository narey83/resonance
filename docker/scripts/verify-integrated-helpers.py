import json,pathlib,subprocess,tempfile,time

def run(*args,**kwargs):return subprocess.run(list(args),check=True,**kwargs)
name='resonance-integrated-provider-test'
try:
 run('docker','run','-d','--name',name,'--network','none','--read-only','--tmpfs','/tmp','-e','HOME=/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','python3','resonance-backend-dev:integrated-tools','/opt/resonance/with-helper.py','backend','python3','-c','import time;time.sleep(300)',stdout=subprocess.DEVNULL)
 probe="import json,urllib.request;print(json.load(urllib.request.urlopen('http://127.0.0.1:4416/ping',timeout=2))['version'])"
 for _ in range(40):
  result=subprocess.run(['docker','exec',name,'python3','-c',probe],capture_output=True,text=True)
  if result.returncode==0:break
  time.sleep(.25)
 if result.returncode:raise RuntimeError(result.stderr)
 print('Bundled provider health:',result.stdout.strip())
 checks="from pathlib import Path; rows=Path('/proc/net/tcp').read_text().splitlines()[1:]; listeners=[r.split()[1] for r in rows if r.split()[1].endswith(':1140')];assert listeners==['0100007F:1140'],listeners;print('Provider listens only on loopback')"
 run('docker','exec',name,'python3','-c',checks)
 run('docker','exec',name,'python3','-c',"import os,signal;from pathlib import Path; pids=[int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit() and (p/'cmdline').read_bytes().split(bytes([0]))[0] == b'/opt/resonance-bgutil/node'];assert len(pids)==1;p=pids[0];os.kill(p,signal.SIGKILL)")
 for _ in range(60):
  time.sleep(.25)
  recovered=subprocess.run(['docker','exec',name,'python3','-c',probe],capture_output=True,text=True)
  if recovered.returncode==0:break
 if recovered.returncode:raise RuntimeError('Provider did not recover')
 print('Provider automatically recovered after forced process exit')
finally:subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL)
name='resonance-integrated-maintenance-test'
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);(root/'state').mkdir()
 source=pathlib.Path('/mnt/data/projects/resonance/docker/caddy/Caddyfile').read_text()
 snippet=source[source.index('(maintenance_routes) {'):source.index('\n(app_routes) {')].replace('/srv/maintenance','/fixture/state')
 (root/'Caddyfile').write_text('{ admin off\n auto_https off\n}\n'+snippet+'\n:8099 {\n route {\n import maintenance_routes\n respond "normal" 200\n }\n}\n')
 try:
  run('docker','run','-d','--name',name,'--network','none','-v',directory+':/fixture','-e','STATE_DIR=/fixture/state','resonance-caddy:integrated-maintenance','caddy','run','--config','/fixture/Caddyfile','--adapter','caddyfile',stdout=subprocess.DEVNULL)
  for _ in range(40):
   response=subprocess.run(['docker','exec',name,'wget','-q','-O-','http://127.0.0.1:8099/maintenance/status'],capture_output=True,text=True)
   if response.returncode==0:break
   time.sleep(.25)
  assert json.loads(response.stdout)['maintenance'] is False,response
  (root/'state/active.json').write_text(json.dumps({'startedAt':time.time(),'observedOffline':False}))
  response=run('docker','exec','-i',name,'nc','-w','2','127.0.0.1','8099',input='GET /api/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',capture_output=True,text=True)
  assert '503' in response.stdout and 'x-resonance-maintenance: true' in response.stdout.lower(),response.stdout
  response=run('docker','exec',name,'wget','-q','-O-','http://127.0.0.1:8099/overview',capture_output=True,text=True)
  assert response.stdout=='normal'
  (root/'state/active.json').unlink()
  response=run('docker','exec',name,'wget','-q','-O-','http://127.0.0.1:8099/api/test',capture_output=True,text=True)
  assert response.stdout=='normal'
  print('Caddy-owned coordinator: status, maintenance API response, web assets and normal recovery passed')
 finally:subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL)
