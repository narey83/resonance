#!/usr/bin/env python3
"""Build native/cross-platform archives including full corresponding source."""
from pathlib import Path
import os, subprocess, tempfile, shutil, zipfile, plistlib, hashlib, json, base64
root=Path(__file__).resolve().parent
output=Path(os.environ.get('RESONANCE_HELPER_OUTPUT',root/'dist'));output.mkdir(parents=True,exist_ok=True)
go=os.environ.get('GO','go')
version='0.3.7'
public_key=os.environ.get('RESONANCE_HELPER_UPDATE_PUBLIC_KEY','')
if public_key and len(base64.b64decode(public_key,validate=True))!=32:
 raise ValueError('RESONANCE_HELPER_UPDATE_PUBLIC_KEY must be a base64 Ed25519 public key')
signing_key=os.environ.get('RESONANCE_HELPER_SIGNING_KEY','')
if signing_key and Path(signing_key).resolve().is_relative_to(root):
 raise ValueError('Keep the release signing key outside the helper source tree')
if signing_key:
 private=base64.b64decode(Path(signing_key).read_text().strip(),validate=True)
 if len(private)!=64 or base64.b64encode(private[32:]).decode()!=public_key:
  raise ValueError('Release signing key must match the embedded public key')

def archive(folder,path):
 with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(folder.rglob('*')):
   if p.is_file(): z.write(p,p.relative_to(folder))
def source(dest):
 shutil.copytree(root,dest,ignore=shutil.ignore_patterns('dist','__pycache__','*.pyc','.DS_Store','*.zip','*.key','*.pem','resonance-bridge','resonance-bridge.exe','resonance-pioneer-link','resonance-pioneer-link.exe'))
 # Preserve the canonical inputs needed to regenerate the embedded UI palettes.
 theme_sources=root.parents[1]/'frontend/src/components'
 if not theme_sources.exists():theme_sources=root/'theme-sources'
 for name in ['App.css','MusicWorkspace.css','Shared/ResonanceMark.jsx']:
  target=dest/'theme-sources'/name;target.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(theme_sources/name,target)

with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp)
 src=tmp/'source';src.mkdir();source(src/'resonance-bridge');archive(src,output/'resonance-bridge-source.zip')
 for platform,goos,arch in [('macos','darwin','arm64'),('windows','windows','amd64'),('linux','linux','amd64')]:
  stage=tmp/platform;stage.mkdir();source(stage/'source');shutil.copy2(root/'README.md',stage/'README.md')
  target=stage/('resonance-bridge.exe' if goos=='windows' else 'resonance-bridge')
  if goos=='darwin':
   app=stage/'Resonance Bridge.app'/'Contents';(app/'MacOS').mkdir(parents=True)
   target=app/'MacOS'/'resonance-bridge'
   (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleName':'Resonance Bridge','CFBundleIdentifier':'app.resonance.bridge','CFBundleExecutable':target.name,'CFBundleVersion':version,'CFBundlePackageType':'APPL','LSMinimumSystemVersion':'12.0'}))
  prebuilt=os.environ.get('RESONANCE_HELPER_PREBUILT_DIR')
  if prebuilt:
   info=json.loads((Path(prebuilt)/'build-info.json').read_text())
   name=goos+'-'+arch+('.exe' if goos=='windows' else '')
   source_binary=Path(prebuilt)/name
   if info['version']!=version or info['publicKey']!=public_key or info['binaries'].get(name)!=hashlib.sha256(source_binary.read_bytes()).hexdigest():
    raise ValueError('Prebuilt engine does not match release version, verification key or build hash')
   shutil.copy2(source_binary,target)
  else:
   subprocess.run([go,'build','-trimpath','-ldflags='+(' -H=windowsgui' if goos=='windows' else '')+' -X main.helperVersion='+version+' -X main.updatePublicKey='+public_key,'-o',str(target),'.'],cwd=root,env={**os.environ,'GOOS':goos,'GOARCH':arch,'CGO_ENABLED':'0'},check=True)
  target.chmod(0o755)
  if signing_key:
   subprocess.run([go,'run','./cmd/helper-release','--key',signing_key,'--binary',str(target),'--version',version,'--os',goos,'--arch',arch,'--output',str(output/'releases')],cwd=root,check=True)
  if goos=="darwin":subprocess.run(["python3",str(root/"native/macos/build.py"),str(stage/"Resonance Bridge.app")],check=True)
  archive(stage,output/f'resonance-bridge-{platform}.zip')
report={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in output.glob('*.zip')}
(output/'checksums.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
