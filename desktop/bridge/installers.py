#!/usr/bin/env python3
"""Reproducible development installers. No signing credentials required or embedded."""
from pathlib import Path
import os,shutil,subprocess,tempfile,zipfile,tarfile,io,time,json,hashlib
root=Path(__file__).resolve().parent
output=Path(os.environ.get('RESONANCE_HELPER_OUTPUT',root/'dist'));output.mkdir(parents=True,exist_ok=True)
version='0.3.21'
def unpack(platform,dest):
 with zipfile.ZipFile(output/f'resonance-bridge-{platform}.zip') as z:
  z.extractall(dest)
  for info in z.infolist():
   mode=info.external_attr>>16
   if mode:os.chmod(dest/info.filename,mode)
def ar_member(name,data):
 header=f'{name+"/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'.encode()
 return header+data+(b'\n' if len(data)%2 else b'')
def tar_bytes(folder):
 buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w:gz') as tar:
  def owned(info):
   info.uid=info.gid=0;info.uname=info.gname='root';return info
  for path in sorted(folder.rglob('*')):tar.add(path,arcname='./'+str(path.relative_to(folder)),recursive=False,filter=owned)
 return buf.getvalue()
with tempfile.TemporaryDirectory() as temporary:
 tmp=Path(temporary)
 # Standard macOS application installer. Sign-in startup is registered on first app launch.
 mac=tmp/'mac';unpack('macos',mac)
 app=mac/'Resonance Bridge.app';resources=app/'Contents/Resources';resources.mkdir(exist_ok=True)
 shutil.copytree(mac/'source',resources/'source');shutil.copy2(root/'README.md',resources/'README.md')
 import plistlib
 plist=plistlib.loads((app/'Contents/Info.plist').read_bytes());plist.update({'CFBundleShortVersionString':version,'NSLocalNetworkUsageDescription':'Discover compatible DJ players and serve your Resonance music library on the selected local network.'});(app/'Contents/Info.plist').write_bytes(plistlib.dumps(plist))
 subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-',str(app)],check=True)
 pkgroot=tmp/'pkgroot';pkgroot.mkdir();shutil.move(str(app),pkgroot/app.name)
 component=tmp/'components.plist';component.write_bytes(plistlib.dumps([{'RootRelativeBundlePath':app.name,'BundleIsRelocatable':False,'BundleHasStrictIdentifier':True,'BundleOverwriteAction':'upgrade'}]))
 scripts=tmp/'scripts';scripts.mkdir()
 preinstall=scripts/'preinstall';preinstall.write_text('''#!/bin/sh
set -eu
legacy="/Applications/Resonance Bridge.app"
if [ -d "$legacy" ]; then
 identifier=$(/usr/bin/defaults read "$legacy/Contents/Info" CFBundleIdentifier 2>/dev/null || true)
 if [ "$identifier" = "app.resonance.pioneer-link" ]; then
  /bin/rm -rf "$legacy"
 fi
fi
exit 0
''');preinstall.chmod(0o755)
 subprocess.run(['/usr/bin/pkgbuild','--root',str(pkgroot),'--component-plist',str(component),'--scripts',str(scripts),'--install-location','/Applications','--identifier','app.resonance.bridge','--version',version,str(output/'resonance-bridge-macos.pkg')],check=True)
 # Windows per-user installer, Start menu shortcuts and registered uninstaller.
 win=tmp/'windows';unpack('windows',win)
 icon=root/'assets/favicon.ico'
 nsi=tmp/'installer.nsi';script=r'''
Unicode true
!include "MUI2.nsh"
Name "Resonance Bridge"
OutFile "@OUTPUT@"
InstallDir "$LOCALAPPDATA\Programs\Resonance Bridge"
InstallDirRegKey HKCU "Software\Resonance\Bridge" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_ICON "@ICON@"
!define MUI_UNICON "@ICON@"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "@SOURCE@\source\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\resonance-bridge.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Resonance Bridge"
 SetOutPath "$INSTDIR"
 File /r "@SOURCE@\*.*"
 WriteRegStr HKCU "Software\Classes\.resonance" "" "Resonance.Bridge.Connection"
 WriteRegStr HKCU "Software\Classes\Resonance.Bridge.Connection" "" "Resonance Bridge Action"
 WriteRegStr HKCU "Software\Classes\Resonance.Bridge.Connection\DefaultIcon" "" "$INSTDIR\source\assets\favicon.ico"
 WriteRegStr HKCU "Software\Classes\Resonance.Bridge.Connection\shell\open\command" "" '$\"$INSTDIR\resonance-bridge.exe$\" $\"%1$\"'
 System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Resonance Bridge"
 CreateShortcut "$SMPROGRAMS\Resonance Bridge\Resonance Bridge.lnk" "$INSTDIR\resonance-bridge.exe" "" "$INSTDIR\source\assets\favicon.ico"
 CreateShortcut "$SMPROGRAMS\Resonance Bridge\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\Resonance\Bridge" "InstallDir" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResonanceBridge" "DisplayName" "Resonance Bridge"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResonanceBridge" "DisplayVersion" "0.3.21"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResonanceBridge" "Publisher" "Resonance"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResonanceBridge" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResonanceBridge" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResonanceBridge" "NoRepair" 1
SectionEnd
Section "Uninstall"
 ReadRegStr $0 HKCU "Software\Classes\.resonance" ""
 StrCmp $0 "Resonance.Bridge.Connection" 0 +2
 DeleteRegValue HKCU "Software\Classes\.resonance" ""
 DeleteRegKey HKCU "Software\Classes\Resonance.Bridge.Connection"
 System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

 Delete "$SMPROGRAMS\Resonance Bridge\Resonance Bridge.lnk"
 Delete "$SMPROGRAMS\Resonance Bridge\Uninstall.lnk"
 RMDir "$SMPROGRAMS\Resonance Bridge"
 Delete "$INSTDIR\resonance-bridge.exe"
 Delete "$INSTDIR\README.md"
 RMDir /r "$INSTDIR\source"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ResonanceHelper"
 DeleteRegKey HKCU "Software\Resonance\Bridge"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResonanceBridge"
SectionEnd
'''
 for key,value in {'OUTPUT':str(output/'resonance-bridge-windows-setup.exe'),'ICON':str(icon),'SOURCE':str(win)}.items():script=script.replace('@'+key+'@',value)
 nsi.write_text(script);subprocess.run([os.environ.get('MAKENSIS','makensis'),str(nsi)],check=True)
 # Debian/Ubuntu amd64: standard dpkg package with desktop launcher, no services/root runtime.
 linux=tmp/'linux';unpack('linux',linux);payload=tmp/'payload';appdir=payload/'opt/resonance-bridge';appdir.mkdir(parents=True)
 shutil.copy2(linux/'resonance-bridge',appdir/'resonance-bridge');(appdir/'resonance-bridge').chmod(0o755);shutil.copytree(linux/'source',appdir/'source');shutil.copy2(root/'README.md',appdir/'README.md')
 desktop=payload/'usr/share/applications';desktop.mkdir(parents=True);(desktop/'resonance-bridge.desktop').write_text('[Desktop Entry]\nType=Application\nName=Resonance Bridge\nComment=Resonance desktop tools and device integration\nExec=/opt/resonance-bridge/resonance-bridge %f\nMimeType=application/vnd.resonance.handoff+json;\nIcon=resonance-bridge\nTerminal=false\nCategories=AudioVideo;Audio;\n')
 icons=payload/'usr/share/icons/hicolor/scalable/apps';icons.mkdir(parents=True);shutil.copy2(root/'assets/favicon.svg',icons/'resonance-bridge.svg')
 mime=payload/'usr/share/mime/packages';mime.mkdir(parents=True);(mime/'resonance-bridge.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info"><mime-type type="application/vnd.resonance.handoff+json"><comment>Resonance Bridge Action</comment><glob pattern="*.resonance"/></mime-type></mime-info>')
 control=tmp/'control';control.mkdir();(control/'control').write_text(f'Package: resonance-bridge\nVersion: {version}\nArchitecture: amd64\nMaintainer: Resonance\nDepends: xdg-utils\nSection: sound\nPriority: optional\nInstalled-Size: {sum(p.stat().st_size for p in payload.rglob("*") if p.is_file())//1024}\nDescription: Resonance Bridge (experimental)\n Streams a prepared Resonance library to compatible DJ hardware.\n Physical player compatibility requires validation.\n')
 for script in ['postinst','postrm']:
  path=control/script;path.write_text('#!/bin/sh\nset -e\nif command -v update-mime-database >/dev/null 2>&1; then update-mime-database /usr/share/mime; fi\nif command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database /usr/share/applications; fi\nexit 0\n');path.chmod(0o755)
 package=b'!<arch>\n'+ar_member('debian-binary',b'2.0\n')+ar_member('control.tar.gz',tar_bytes(control))+ar_member('data.tar.gz',tar_bytes(payload))
 (output/'resonance-bridge-linux-amd64.deb').write_bytes(package)
report={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in output.iterdir() if p.suffix in ['.zip','.pkg','.exe','.deb']};(output/'checksums.json').write_text(json.dumps(report,indent=2)+'\n')
