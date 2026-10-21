#!/usr/bin/env python3
"""Build native/cross-platform archives including full corresponding source."""
from pathlib import Path
import os, subprocess, tempfile, shutil, zipfile, plistlib, hashlib, json
root=Path(__file__).resolve().parent
output=Path(os.environ.get('RESONANCE_HELPER_OUTPUT',root/'dist'));output.mkdir(parents=True,exist_ok=True)
go=os.environ.get('GO','go')
def archive(folder,path):
 with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(folder.rglob('*')):
   if p.is_file(): z.write(p,p.relative_to(folder))
def source(dest):
 shutil.copytree(root,dest,ignore=shutil.ignore_patterns('dist','.DS_Store','*.zip','resonance-pioneer-link','resonance-pioneer-link.exe'))
with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp)
 src=tmp/'source';src.mkdir();source(src/'resonance-pioneer-link');archive(src,output/'resonance-pioneer-link-source.zip')
 for platform,goos,arch in [('macos','darwin','arm64'),('windows','windows','amd64'),('linux','linux','amd64')]:
  stage=tmp/platform;stage.mkdir();source(stage/'source');shutil.copy2(root/'README.md',stage/'README.md')
  target=stage/('resonance-pioneer-link.exe' if goos=='windows' else 'resonance-pioneer-link')
  if goos=='darwin':
   app=stage/'Resonance Pioneer Link.app'/'Contents';(app/'MacOS').mkdir(parents=True)
   target=app/'MacOS'/'resonance-pioneer-link'
   (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleName':'Resonance Pioneer Link','CFBundleIdentifier':'app.resonance.pioneer-link','CFBundleExecutable':target.name,'CFBundleVersion':'0.2.0','CFBundlePackageType':'APPL','LSMinimumSystemVersion':'12.0'}))
  subprocess.run([go,'build','-trimpath',*(['-ldflags=-H=windowsgui'] if goos=='windows' else []),'-o',str(target),'.'],cwd=root,env={**os.environ,'GOOS':goos,'GOARCH':arch,'CGO_ENABLED':'0'},check=True)
  target.chmod(0o755)
  if goos=="darwin":subprocess.run(["python3",str(root/"native/macos/build.py"),str(stage/"Resonance Pioneer Link.app")],check=True)
  archive(stage,output/f'resonance-pioneer-link-{platform}.zip')
report={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in output.glob('*.zip')}
(output/'checksums.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
