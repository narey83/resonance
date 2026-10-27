#!/usr/bin/env python3
from pathlib import Path
import subprocess,sys,plistlib
app=Path(sys.argv[1]);root=Path(__file__).resolve().parent
binary=app/'Contents/MacOS/resonance-bridge';engine=binary.with_name('resonance-bridge-engine');binary.rename(engine)
subprocess.run(['/usr/bin/swiftc','-swift-version','5','-O','-target','arm64-apple-macos12.0',str(root/'main.swift'),'-o',str(binary)],check=True)
path=app/'Contents/Info.plist';p=plistlib.loads(path.read_bytes());p.update({'CFBundleDisplayName':'Resonance Bridge','LSUIElement':True,'CFBundleDocumentTypes':[{'CFBundleTypeName':'Resonance Bridge Action','CFBundleTypeRole':'Viewer','LSHandlerRank':'Owner','LSItemContentTypes':['app.resonance.handoff']}], 'UTExportedTypeDeclarations':[{'UTTypeIdentifier':'app.resonance.handoff','UTTypeDescription':'Resonance Bridge Action','UTTypeConformsTo':['public.data','public.content'],'UTTypeTagSpecification':{'public.filename-extension':['resonance','resonancelink','resonanceusb'],'public.mime-type':['application/vnd.resonance.handoff+json','application/vnd.resonance.link+json','application/vnd.resonance.usb+json']}}]});path.write_bytes(plistlib.dumps(p))
subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-',str(app)],check=True)
