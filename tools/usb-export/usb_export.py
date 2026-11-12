"""Stage a NEW dual-library USB export; no physical drive operations."""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess,sys
from anlz_writer import write_anlz,path_for_audio
from onelibrary_writer import write_onelibrary,validate_onelibrary

def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def export_key(value):
 value=str(value or '').strip()
 minor=['Abm','Ebm','Bbm','Fm','Cm','Gm','Dm','Am','Em','Bm','F#m','Dbm'];major=['B','F#','Db','Ab','Eb','Bb','F','C','G','D','A','E']
 if len(value)>=2 and value[:-1].isdigit() and value[-1].upper() in ['A','B']:
  number=int(value[:-1])
  if 1<=number<=12:return (minor if value[-1].upper()=='A' else major)[number-1]
 aliases={'C#':'Db','D#':'Eb','G#':'Ab','A#':'Bb','Gb':'F#','C#m':'Dbm','D#m':'Ebm','G#m':'Abm','A#m':'Bbm','Gbm':'F#m'}
 value=aliases.get(value,value)
 if value and value not in minor+major:raise ValueError('Unrecognised musical key; correct it before exporting')
 return value

def source_audio(path,ffprobe,profile='dual',player_model=None):
 extension=Path(path).suffix.lower()
 if profile=='legacy' and not player_model and extension not in ('.mp3','.wav','.aif','.aiff'):
  raise ValueError('Choose a specific player model before exporting this audio format')
 codecs={'.mp3':{'mp3'},'.flac':{'flac'},'.wav':{'pcm_s16le','pcm_s24le'},'.aif':{'pcm_s16be','pcm_s24be'},'.aiff':{'pcm_s16be','pcm_s24be'},'.m4a':{'aac','alac'}}
 if extension not in codecs:raise ValueError(f'Unsupported USB audio format: {extension or "none"}')
 command=[ffprobe,'-v','error','-select_streams','a:0','-show_entries','stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample,bit_rate:format=duration,bit_rate','-of','json',str(path)]
 result=subprocess.run(command,capture_output=True,timeout=120)
 if result.returncode:raise ValueError('Could not inspect source audio: '+result.stderr.decode(errors='replace')[-500:])
 data=json.loads(result.stdout);streams=data.get('streams') or []
 if len(streams)!=1:raise ValueError('Source has no readable audio stream')
 stream=streams[0];codec=stream.get('codec_name');rate=int(stream.get('sample_rate') or 0);channels=int(stream.get('channels') or 0)
 depth=int(stream.get('bits_per_raw_sample') or stream.get('bits_per_sample') or 0)
 bit_rate=int(stream.get('bit_rate') or data.get('format',{}).get('bit_rate') or 0)
 duration=float(data.get('format',{}).get('duration') or 0)
 if codec not in codecs[extension]:raise ValueError(f'Audio codec {codec or "unknown"} does not match {extension}')
 if channels not in (1,2):raise ValueError('USB players require mono or stereo audio')
 if rate not in (44100,48000,88200,96000):raise ValueError('Source sample rate is not supported by the selected players')
 if codec in ('mp3','aac'):
  if rate not in (44100,48000) or not 32000<=bit_rate<=320000:raise ValueError('Compressed audio rate is outside player limits')
  depth=16
 elif depth not in (16,24):raise ValueError('Source bit depth is not supported by the selected players')
 if profile=='legacy' and not player_model and (rate not in (44100,48000) or depth!=16):
  raise ValueError('Choose a specific player model for this sample rate or bit depth')
 if duration<=0 or bit_rate<=0:raise ValueError('Incomplete source audio metadata')
 return {'codec':codec,'sampleRate':rate,'bitRate':round(bit_rate/1000),'bitDepth':depth,'durationSeconds':duration}

def prepare(manifest,destination,profile,ffmpeg,ffprobe=None):
 from rekordbox_pdb import Database,ExtDatabase
 from rekordbox_pdb.edit import PdbEditor
 root=Path(destination)
 if root.exists():raise FileExistsError('Choose a new staging destination')
 if profile not in ['dual','legacy','network'] or manifest.get('schemaVersion')!=1 or not manifest.get('tracks'):raise ValueError('Invalid export manifest/profile')
 ids=[t['id'] for t in manifest['tracks']]
 if ids!=list(range(1,len(ids)+1)):raise ValueError('Sequential positive export IDs required')
 # Validate all sources before making output; prepare only an explicitly new staging tree.
 for t in manifest['tracks']:
  source=Path(t['sourcePath'])
  if not source.is_absolute() or not source.is_file() or source.is_symlink():raise ValueError('Source identity invalid')
  if profile=='network':
   if source.stat().st_size!=t.get('sourceBytes'):raise ValueError('Source identity invalid')
  elif sha(source)!=t['sourceSha256']:raise ValueError('Source identity invalid')
  if not t['analysis'].get('scope',{}).get('fullTrack'):raise ValueError('Full-track analysis required')
  if not all(t['analysis']['featureAvailability'].get(k)=='available' for k in ['beats','waveform','key']):raise ValueError('Required analysis unavailable')
 required=sum((1024*1024 if profile=='network' else Path(t['sourcePath']).stat().st_size+1024*1024) for t in manifest['tracks'])
 root.parent.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(root.parent).free<required*1.1:raise ValueError('Insufficient staging space for USB audio')
 root.mkdir()
 if profile!='network':(root/'Contents/Resonance').mkdir(parents=True)
 dbdir=root/'PIONEER/rekordbox';dbdir.mkdir(parents=True);here=Path(__file__).resolve().parent;ed=PdbEditor((here/'legacy-empty-template.pdb').read_bytes());normalized=[];analysis_checks=[];used=set()
 try:
  for t in manifest['tracks']:
   a=t['analysis'];grid=a['features']['beats']['result'];stem=f"{t['id']:05d}-track";attempt=0
   while True:
    extension=Path(t['sourcePath']).suffix.lower()
    if profile=='network' and extension not in ['.mp3','.m4a','.aac','.flac','.wav','.aiff','.aif']:raise ValueError('Network Link source format is not supported by Pioneer players')
    usb=f"/Contents/Resonance/{stem}{('-'+str(attempt)) if attempt else ''}{extension}";anlz=path_for_audio(usb)
    if anlz not in used:used.add(anlz);break
    attempt+=1
    if attempt>100:raise ValueError('Analysis hash collision could not be resolved')
   target=root/usb.lstrip('/')
   if profile=='network':
    duration=a['durationSeconds'];file_bytes=Path(t['sourcePath']).stat().st_size;sample_rate=int(t.get('sampleRate') or 44100);bit_rate=int(t.get('bitRate') or max(1,round(file_bytes*8/max(duration,1)/1000)));bit_depth=int(t.get('bitDepth') or 16)
   else:
    info=source_audio(t['sourcePath'],ffprobe or str(Path(ffmpeg).with_name('ffprobe')),profile,manifest.get('playerModel'))
    duration=a['durationSeconds']
    if abs(info['durationSeconds']-duration)>.2:raise ValueError('Source audio duration differs from analysis timeline')
    shutil.copyfile(t['sourcePath'],target)
    if sha(target)!=t['sourceSha256']:raise ValueError('Copied source audio checksum differs')
    file_bytes=target.stat().st_size;sample_rate=info['sampleRate'];bit_rate=info['bitRate'];bit_depth=info['bitDepth']
   if file_bytes>=2**32:raise ValueError('Track exceeds player file-size limit')
   genre=t.get('genre') or max(a['features']['genre']['result'].get('scores',[]),key=lambda r:r.get('cosine',-1),default={}).get('label','')
   rec={'id':t['id'],'title':t.get('title') or Path(t['sourcePath']).stem,'artist':t.get('artist') or '', 'album':t.get('album') or '', 'genre':genre,'key':export_key(t.get('key') or a['features']['key']['result']['key']),'bpm':grid['bpm_median_interval'],'durationSeconds':duration,'sampleRate':sample_rate,'bitRate':bit_rate,'bitDepth':bit_depth,'codec':(info['codec'] if profile!='network' else ''),'fileBytes':file_bytes,'usbPath':usb,'anlzPath':anlz,'cues':t.get('cues') or []}
   tid=ed.add_track(title=rec['title'],file_path=usb,artist=rec['artist'],album=rec['album'],genre=rec['genre'],key=rec['key'],tempo=round(rec['bpm']*100),duration=round(duration),sample_rate=(44100 if profile=='network' else sample_rate),bitrate=(1411 if profile=='network' else bit_rate),sample_depth=(16 if profile=='network' else bit_depth),file_size=rec['fileBytes'],analyze_path=anlz)
   if tid!=rec['id']:raise ValueError('Database ID allocation mismatch')
   analysis_checks.append(write_anlz(root,rec,a));normalized.append(rec)
   if profile=='network':
    if Path(t['sourcePath']).stat().st_size!=t.get('sourceBytes'):raise ValueError('Source changed during export')
   elif sha(t['sourcePath'])!=t['sourceSha256']:raise ValueError('Source changed during export')
   print(json.dumps({'stage':'audio-and-analysis','prepared':len(normalized),'total':len(ids)}),flush=True)
  playlist=ed.create_playlist(manifest.get('playlistName') or 'Resonance')
  for t in normalized:ed.add_to_playlist(playlist,t['id'])
  ed.save(dbdir/'export.pdb');shutil.copy2(here/'legacy-empty-templateExt.pdb',dbdir/'exportExt.pdb');parsed=Database.from_file(dbdir/'export.pdb');ExtDatabase.from_file(dbdir/'exportExt.pdb')
  if len(parsed.tracks)!=len(ids) or [e.track_id for e in parsed.playlist_entries]!=ids:raise ValueError('Legacy database playlist readback mismatch')
  for row,track in zip(parsed.tracks,normalized):
   if row.title!=track['title'] or row.file_path!=track['usbPath'] or row.analyze_path!=track['anlzPath']:raise ValueError('Legacy track readback mismatch')
  one=None
  if profile=='dual':one=validate_onelibrary(write_onelibrary(root,normalized,manifest.get('playlistName') or 'Resonance'),normalized)
  files=[{'path':p.relative_to(root).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(root.rglob('*')) if p.is_file()]
  streams=([{'path':t['usbPath'].lstrip('/'),'sourceKey':manifest['tracks'][i]['sourceKey'],'sha256':manifest['tracks'][i]['sourceSha256'],'bytes':t['fileBytes']} for i,t in enumerate(normalized)] if profile=='network' else [])
  result={'schemaVersion':1,'source':manifest.get('source'),'profile':profile,'playerModel':manifest.get('playerModel'),'trackCount':len(ids),'playlistName':manifest.get('playlistName') or 'Resonance','sourceKeys':{str(t['id']):t.get('sourceKey','') for t in manifest['tracks']},'streams':streams,'hardwareValidated':False,'audioPolicy':('Authenticated range streaming from Resonance; no audio stored by Bridge' if profile=='network' else 'Original supported audio copied without transcoding'),'files':files,'validation':{'legacyTracks':len(parsed.tracks),'oneLibrary':one,'analysis':analysis_checks},'limitations':['Experimental independent device-library encoder; on-device playback and hot cues not yet verified','Automatically saved cues are exported as hot cues; manual bookmark and loop export remain pending','Independent vocal/phrase labels are not encoded as undocumented proprietary song-structure records','Artwork export is not yet included','FAT32 recommended for older players; exact model and firmware limits apply']}
  (root/'export-manifest.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
  from export_inspection import write_inspection
  write_inspection(root,root.parent/'inspection.json')
  return result
 except BaseException:
  # Only this invocation-created staging directory can be removed.
  shutil.rmtree(root);raise

def main():
 p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--destination',required=True);p.add_argument('--profile',choices=['dual','legacy','network'],required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--ffprobe');a=p.parse_args();result=prepare(json.loads(Path(a.manifest).read_text()),a.destination,a.profile,a.ffmpeg,a.ffprobe);print(json.dumps({'status':'complete','trackCount':result['trackCount'],'profile':a.profile}),flush=True)
if __name__=='__main__':main()
