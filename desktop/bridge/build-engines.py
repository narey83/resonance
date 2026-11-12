#!/usr/bin/env python3
"""Cross-build signed helper engines on the build server; package natively on macOS."""
from pathlib import Path
import base64, hashlib, json, os, subprocess
root=Path(__file__).resolve().parent
go=os.environ.get('GO','go')
output=Path(os.environ.get('RESONANCE_HELPER_OUTPUT',root/'dist'))
prebuilt=output/'prebuilt';prebuilt.mkdir(parents=True,exist_ok=True)
key=Path(os.environ['RESONANCE_HELPER_SIGNING_KEY']).resolve()
if key.is_relative_to(root):raise ValueError('Keep the private key outside the source tree')
private=base64.b64decode(key.read_text().strip(),validate=True)
if len(private)!=64:raise ValueError('Invalid Ed25519 private key')
public=base64.b64encode(private[32:]).decode()
version='0.3.14'
info={'version':version,'publicKey':public,'binaries':{}}
for goos,arch in [('darwin','arm64'),('windows','amd64'),('linux','amd64')]:
 name=goos+'-'+arch+('.exe' if goos=='windows' else '')
 binary=prebuilt/name
 flags=('-H=windowsgui ' if goos=='windows' else '')+'-X main.helperVersion='+version+' -X main.updatePublicKey='+public
 subprocess.run([go,'build','-trimpath','-ldflags',flags,'-o',str(binary),'.'],cwd=root,env={**os.environ,'GOOS':goos,'GOARCH':arch,'CGO_ENABLED':'0'},check=True)
 subprocess.run([go,'run','./cmd/helper-release','--key',str(key),'--binary',str(binary),'--version',version,'--os',goos,'--arch',arch,'--output',str(output/'releases')],cwd=root,check=True)
 info['binaries'][name]=hashlib.sha256(binary.read_bytes()).hexdigest()
(prebuilt/'build-info.json').write_text(json.dumps(info,indent=2)+'\n')
print('Built and signed three helper engines; private key remains outside distributions.')
