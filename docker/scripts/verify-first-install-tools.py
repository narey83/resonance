"""Exercise actual first-start provisioning and offline cache reuse without live data."""
import argparse,hashlib,json,pathlib,subprocess,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--publish-directory',required=True,type=pathlib.Path)
parser.add_argument('--image',default='resonance-backend-dev:latest')
args=parser.parse_args()
PUBLISH=args.publish_directory.resolve()
(ROOT/'.dev').mkdir(exist_ok=True)
NAME='resonance-first-install-tools-test'

def docker(*args,**kwargs):
 result=subprocess.run(['docker',*args],capture_output=True,text=True,**kwargs)
 if result.returncode:raise RuntimeError(result.stderr)
 return result

def start(config,bundle):
 command="import os;os.makedirs('/tmp/wwwroot',exist_ok=True);os.execvp('dotnet',['dotnet','/app/resonance.dll','--app-dir','/config','--content-path','wwwroot','--no-connect'])"
 docker('run','-d','--name',NAME,'--network','none','--read-only','--cpus','1','--memory','2g','--tmpfs','/tmp:exec','-e','HOME=/tmp','-e','RESONANCE_BUNDLED_TOOLS='+bundle,'--mount','type=bind,src='+str(config)+',dst=/config','--mount','type=bind,src='+str(PUBLISH)+',dst=/app,readonly','--entrypoint','python3',args.image,'/opt/resonance/with-helper.py','backend','python3','-c',command)

def stop():
 subprocess.run(['docker','stop','--timeout','30',NAME],capture_output=True)
 subprocess.run(['docker','rm','-f',NAME],capture_output=True)

def wait_for_tools():
 probe="import json,urllib.request;d=json.load(urllib.request.urlopen('http://127.0.0.1:5030/api/v0/startup',timeout=2));print(json.dumps({x['id']:x['state'] for x in d.get('services',[]) if x['id'] in ('ytdlp-dependencies','ytdlp','ffmpeg')}))"
 deadline=time.monotonic()+180
 while time.monotonic()<deadline:
  state=docker('inspect',NAME,'--format','{{.State.Running}}').stdout.strip()
  if state!='true':raise RuntimeError('Isolated backend exited before tool initialization')
  result=subprocess.run(['docker','exec',NAME,'python3','-c',probe],capture_output=True,text=True)
  if result.returncode==0:
   states=json.loads(result.stdout)
   if states.get('ytdlp-dependencies')=='ready' and states.get('ytdlp')=='ready':return states
  time.sleep(1)
 raise RuntimeError('Clean-install startup did not provision tools within three minutes')

def check(config):
 bins={'yt-dlp':config/'data/bin/ytdlp/yt-dlp','deno':config/'data/bin/ytdlp/deno','ffmpeg':config/'data/bin/ffmpeg','ffprobe':config/'data/bin/ffprobe'}
 hashes={}
 for name,path in bins.items():
  if not path.is_file():raise RuntimeError('Missing provisioned '+name)
  hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
  docker('exec',NAME,str(path).replace(str(config),'/config'),'--version' if name in ('yt-dlp','deno') else '-version')
 docker('exec',NAME,'/config/data/bin/ytdlp/deno','eval','if (2 + 2 !== 4) Deno.exit(1)')
 docker('exec',NAME,'/config/data/bin/ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame','/tmp/test.mp3')
 result=docker('exec',NAME,'/config/data/bin/ffprobe','-v','error','-show_entries','format=duration','-of','json','/tmp/test.mp3')
 duration=float(json.loads(result.stdout)['format']['duration'])
 if not .9<duration<1.2:raise RuntimeError('Generated audio duration was invalid')
 return hashes

publish=PUBLISH
(publish/'wwwroot').mkdir(exist_ok=True)
for source in (ROOT/'backend/tools/yt-dlp-plugins').rglob('*.py'):
 target=publish/'tools/yt-dlp-plugins'/source.relative_to(ROOT/'backend/tools/yt-dlp-plugins')
 if not target.is_file() or target.read_bytes()!=source.read_bytes():raise RuntimeError('Published plugin missing or stale: '+source.name)
report={'publishedPlugin':'verified against checked-in stable plugin'}
with tempfile.TemporaryDirectory(prefix='tools-install-',dir=ROOT/'.dev') as directory:
 config=pathlib.Path(directory)
 try:
  if list(config.iterdir()):raise RuntimeError('Test data directory must start empty')
  start(config,'/opt/resonance-tools');report['freshStartup']=wait_for_tools();first=check(config)
  stop()
  start(config,'/nonexistent-bundle');report['cachedOfflineStartup']=wait_for_tools();second=check(config)
  if first!=second:raise RuntimeError('Cached tools changed unexpectedly without network or bundled tools')
  report.update(success=True,checks=['fresh empty data directory','image-bundled tool seeding','all four real binaries execute','Deno executes JavaScript','FFmpeg encodes MP3','ffprobe measures generated audio','offline restart without bundled-tool access reuses identical binaries'])
 finally:stop()
(ROOT/'.dev/first-install-tools-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report),flush=True)
