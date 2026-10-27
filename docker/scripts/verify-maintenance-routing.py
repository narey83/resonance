import json
import pathlib
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--live-origin')
args=parser.parse_args()
name='resonance-maintenance-routing-test'
with tempfile.TemporaryDirectory(prefix='resonance-maintenance-routing-') as directory:
 root=pathlib.Path(directory); (root/'state').mkdir()
 source=(pathlib.Path(__file__).parents[1]/'caddy/Caddyfile').read_text()
 snippet=source[source.index('(maintenance_routes) {'):source.index('\n(app_routes) {')].replace('/srv/maintenance','/fixture/state')
 (root/'Caddyfile').write_text('{ admin off\n auto_https off\n}\n'+snippet+'\n:8099 {\n route {\n import maintenance_routes\n respond "normal" 200\n }\n}\n')
 subprocess.run(['docker','run','-d','--name',name,'--network','none','-v',directory+':/fixture:ro','--entrypoint','caddy','resonance-caddy','run','--config','/fixture/Caddyfile','--adapter','caddyfile'],check=True,stdout=subprocess.DEVNULL)
 try:
  for _ in range(30):
   result=subprocess.run(['docker','exec',name,'wget','-S','-O-','http://127.0.0.1:8099/api/test'],capture_output=True,text=True)
   if 'normal' in result.stdout: break
   time.sleep(.2)
  assert 'normal' in result.stdout,result.stderr
  (root/'state/active.json').write_text('{}')
  result=subprocess.run(['docker','exec','-i',name,'nc','-w','2','127.0.0.1','8099'],input='GET /api/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',capture_output=True,text=True)
  assert '503' in result.stdout and 'x-resonance-maintenance: true' in result.stdout.lower(),result.stdout+result.stderr
  assert 'retry-after: 5' in result.stdout.lower(),result.stdout
  result=subprocess.run(['docker','exec',name,'wget','-q','-O-','http://127.0.0.1:8099/overview'],capture_output=True,text=True)
  assert result.stdout=='normal',result.stderr
  (root/'state/active.json').unlink()
  result=subprocess.run(['docker','exec',name,'wget','-q','-O-','http://127.0.0.1:8099/api/test'],capture_output=True,text=True)
  assert result.stdout=='normal',result.stderr
  print('Caddy routing: normal → maintenance 503/Retry-After → normal; web assets remain available.')
 finally:
  subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,check=True)
if args.live_origin:
 request=urllib.request.Request(args.live_origin.rstrip('/')+'/maintenance/control',data=b'{"action":"restart"}',headers={'Content-Type':'application/json'})
 try:
  urllib.request.urlopen(request,timeout=10)
  raise AssertionError('Unauthenticated maintenance action was allowed')
 except urllib.error.HTTPError as error:
  assert error.code==401,error.code
 print('Live control: unauthenticated restart rejected (401); no backend restart requested.')
