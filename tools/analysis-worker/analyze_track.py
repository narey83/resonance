"""Isolated independent candidates. Explicit local runtimes/models; no downloads.
Never writes sourceaudio, importedanalysis, or native/manualResonance fields.
"""
import argparse,pathlib,json,sys,os,subprocess,hashlib,time,re,signal,resource,struct,shutil,platform
HERE=pathlib.Path(__file__).resolve().parent

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def wav_pcm_identity(files):
 h=hashlib.sha256();total=0;alignment=None
 for path in files:
  with open(path,'rb') as f:
   if f.read(4)!=b'RIFF':raise ValueError('ExpectedRIFFfloatWAV')
   f.read(8)
   while header:=f.read(8):
    if len(header)!=8:raise ValueError('TruncatedWAVheader')
    tag,size=struct.unpack('<4sI',header)
    if tag==b'fmt ':
     fmt=f.read(size);current=struct.unpack_from('<H',fmt,12)[0]
     if alignment is not None and alignment!=current:raise ValueError('InconsistentWAVblockalignment')
     alignment=current
    elif tag==b'data':
     total+=size;remaining=size
     while remaining:
      b=f.read(min(1048576,remaining))
      if not b:raise ValueError('TruncatedWAVPCM')
      h.update(b);remaining-=len(b)
    else:f.seek(size,1)
    if size%2:f.seek(1,1)
 if not alignment or total%alignment:raise ValueError('InvalidWAVdataalignment')
 return {'pcmSha256':h.hexdigest(),'frames':total//alignment,'pcmBytes':total}
def run_owned(arguments,env,timeout):
 # Every engine starts its own processgroup so internal timeouts clean up FFmpeg
 # and runtime descendants belonging to this worker, never unrelated processes.
 process=subprocess.Popen(arguments,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 try:
  stdout,stderr=process.communicate(timeout=timeout)
 except BaseException:
  try:os.killpg(process.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:process.wait(timeout=2)
  except subprocess.TimeoutExpired:
   try:os.killpg(process.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   process.wait()
  raise
 return subprocess.CompletedProcess(arguments,process.returncode,stdout,stderr)
def decode(audio,ffmpeg,sr,seconds):
 import numpy as np
 cmd=[ffmpeg,'-v','error','-i',str(audio)]
 if seconds:cmd+=['-t',str(seconds)]
 cmd+=['-ar',str(sr),'-ac','2','-f','f32le','-']
 return np.frombuffer(subprocess.check_output(cmd),dtype='<f4').reshape(-1,2).mean(axis=1)
def worker(engine,audio,cfg,seconds,out):
 import numpy as np
 ff=cfg['ffmpeg'];settings=cfg.get(engine,{})
 if engine=='beats':
  from beat_engine import BeatEngine
  a=decode(audio,ff,22050,seconds);use_dbn=settings.get('postprocessor','minimal')=='dbn';result=BeatEngine(settings['checkpoint']).analyze(a,22050,include_frame_scores=use_dbn or bool(settings.get('fourFourPhase',False)))
  if settings.get('postprocessor','minimal') not in ('minimal','dbn'):raise ValueError('Unsupported beat postprocessor')
  if use_dbn:
   frames=result['frame_scores'];decoder=HERE/'dbn_decoder.py';run=subprocess.run([settings['dbnPython'],str(decoder)],input=json.dumps(frames).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
   if run.returncode:raise RuntimeError('DBN decoder failed: '+run.stderr.decode()[-2000:])
   result['raw_minimal_grid']={k:result[k] for k in ('beats_seconds','downbeats_seconds','bpm_median_interval','bpm_whole_span')};result.update(json.loads(run.stdout));result['decoder_sha256']=sha(decoder)
   from tempo_summary import summarize_tempo
   beats=np.asarray(result['beats_seconds']);result.update(summarize_tempo(beats));result['bpm_median_interval']=float(60/np.median(np.diff(beats))) if len(beats)>1 else None;result['bpm_whole_span']=float(60*(len(beats)-1)/(beats[-1]-beats[0])) if len(beats)>1 else None
  if settings.get('fourFourPhase',False):
   from bar_phase import choose_global_bar_phase
   result['optionalFourFourPhase']=choose_global_bar_phase(result['beats_seconds'],result['frame_scores']['downbeat_logits']);result.pop('frame_scores',None)
  if settings.get('consensusWeight',0)>0 and cfg.get('semanticPhrases',{}).get('enabled',False):
   frame_path=out.with_name('beat-frame-scores.json');frame_path.write_text(json.dumps(result['frame_scores']));result['frameScoresArtifact']=frame_path.name;result['frameScoresSha256']=sha(frame_path)
  result.pop('frame_scores',None)
  return result
 if engine=='embedding':
  from embedding_engine import EmbeddingEngine
  a=decode(audio,ff,48000,seconds);return EmbeddingEngine(settings['snapshot']).analyze(a,settings.get('prompts'),cfg.get('genre',{}).get('promptProfile') if cfg.get('genre',{}).get('enabled',True) else None)
 if engine=='key':
  a=decode(audio,ff,44100,seconds);p=subprocess.run([sys.executable,str(HERE/'resonance_essentia.py'),settings.get('profile','edma'),'multifeature',str(seconds or 0),'key'],input=a.astype('<f4').tobytes(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
  line=next(x for x in p.stdout.decode().splitlines() if x.startswith('RESONANCE_JSON:'));r=json.loads(line.split(':',1)[1]);
  if 'key' not in r:raise ValueError(r.get('keyError','No keyresult'))
  import essentia
  return {'key':r['key'],'engine':'Essentia.KeyExtractor','version':essentia.__version__,'profile':settings.get('profile','edma'),'confidence':None,'embeddedScriptSha256':sha(HERE/'resonance_essentia.py'),'semantics':'ExistingResonanceindependentkeyextractor,notnativeRekordboxkeyreconstruction'}
 if engine=='waveform':
  a=decode(audio,ff,44100,seconds);n=len(a);bars=min(200000,max(1,int(np.ceil(n/44100*200))));edges=np.linspace(0,n,bars+1,dtype=int);freq=np.fft.rfftfreq(n,1/44100);fft=np.fft.rfft(a);bands={}
  for name,mask in [('low',freq<300),('mid',(freq>=300)&(freq<2000)),('high',freq>=2000)]:
   values=np.fft.irfft(fft*mask,n=n);bands[name]=[float(np.max(abs(values[edges[i]:edges[i+1]]))) if edges[i+1]>edges[i] else 0 for i in range(bars)]
  return {'engine':'IndependentFFTdisplaybands','sampleRate':44100,'durationSeconds':n/44100,'bars':bars,'overallPeaks':[float(np.max(abs(a[edges[i]:edges[i+1]]))) if edges[i+1]>edges[i] else 0 for i in range(bars)],'bands':bands,'boundariesHz':[300,2000],'normalization':'RawabsolutePCMpeaks,nopertrackdisplaynormalization','semantics':'NewidealFFTbanddisplaydesign; notRekordboxPWVnorResonancecausalfilterparity'}
 if engine=='energy':
  a=decode(audio,ff,22050,seconds);window=22050;v=[float(np.sqrt(np.mean(a[i:i+window].astype(float)**2))) for i in range(0,len(a),window)];return {'engine':'PCM-RMS','windowSeconds':1,'rms':v,'rmsDbfs':[float(20*np.log10(max(x,1e-12))) for x in v],'semantics':'Descriptivesignalenergy,notRekordboxdanceability/energymodelscore','confidence':None}
 if engine=='loudness':
  cmd=[ff,'-hide_banner','-i',str(audio)];cmd+=['-t',str(seconds)] if seconds else [];cmd+=['-af','ebur128=peak=true','-f','null','-'];p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True);text=p.stderr.decode();summary=text.rsplit('Summary:',1)[-1];r={}
  for key,pattern in [('integratedLufs',r'^\s*I:\s*(-?[\d.]+)\s*LUFS'),('truePeakDbfs',r'^\s*Peak:\s*(-?[\d.]+)\s*dBFS'),('loudnessRangeLu',r'^\s*LRA:\s*(-?[\d.]+)\s*LU')]:
   m=re.search(pattern,summary,re.M)
   if not m:raise ValueError('No completeR128summary')
   r[key]=float(m[1])
  r['engine']='FFmpeg.ebur128';r['semantics']='MeasuredR128summaryusingexistingResonanceparsingconvention';return r
 raise ValueError('Unknownworkerengine')

def automatic_dj(doc, cfg, base_artifacts, out, timeout):
 from secondary_profiles import dj_structure,percussion_bins
 from dj_boundaries import refine_dj_boundaries
 from dj_arrangement import extract_frames,analyze_arrangement
 semantic=doc['features']['semanticPhrases']['result'];duration=doc['durationSeconds'];stems=base_artifacts/'stems'
 for name,row in doc['features']['stems']['result']['stems'].items():
  if sha(stems/(name+'.wav'))!=row['sha256']:raise ValueError('DJ source stem identity mismatch')
 # Reconstruct the same baseline on every refresh; never stack refinements.
 profile=dj_structure(semantic['segments'],percussion_bins(stems/'drums.wav',cfg['ffmpeg']),duration,percussion_bins(stems/'bass.wav',cfg['ffmpeg']))
 grid=doc['features']['beats']['result']['downbeats_seconds']
 profile=refine_dj_boundaries(profile,percussion_bins(stems/'drums.wav',cfg['ffmpeg'],step_seconds=.1),duration,grid)
 if cfg.get('semanticPhrases',{}).get('genreAware',True):
  frames=extract_frames(stems,cfg['ffmpeg'],duration,timeout_seconds=timeout)
  feature_path=out/'dj-arrangement-features.json';feature_path.write_text(json.dumps(frames,allow_nan=False))
  profile=analyze_arrangement(profile,semantic['segments'],frames,duration,grid,doc['features'].get('genre',{}).get('result'))
  profile['featureArtifactSha256']=sha(feature_path)
 semantic['djStructure']=profile
 for name in ['dj_arrangement.py','dj_boundaries.py','secondary_profiles.py']:doc['provenance']['helperScriptSha256'][name]=sha(HERE/name)
 return profile

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('audio',type=pathlib.Path);p.add_argument('--config',required=True,type=pathlib.Path);p.add_argument('--output-dir',required=True,type=pathlib.Path);p.add_argument('--seconds',type=float);p.add_argument('--engine',help=argparse.SUPPRESS);p.add_argument('--reuse-candidate',type=pathlib.Path);p.add_argument('--refresh-dj-only',action='store_true');a=p.parse_args()
 if a.refresh_dj_only and not a.reuse_candidate:p.error('DJ refresh requires an existing candidate')
 if a.seconds is not None and not 0<a.seconds<=86400:p.error('seconds mustbe0..86400')
 cfg=json.load(open(a.config));audio=a.audio.resolve(strict=True)
 if a.engine:
  result=worker(a.engine,audio,cfg,a.seconds,a.output_dir);a.output_dir.write_text(json.dumps(result,allow_nan=False));return
 out=a.output_dir.resolve();out.mkdir(parents=True,exist_ok=False);start=time.time();identity={'sha256':sha(audio),'bytes':audio.stat().st_size};doc={'schemaVersion':1,'sourceKind':'independent-candidate','audioIdentity':identity,'scope':{'requestedSeconds':a.seconds,'fullTrack':a.seconds is None},'durationSeconds':None,'features':{},'featureAvailability':{},'provenance':{'orchestratorSha256':sha(__file__),'configSha256':sha(a.config),'downloads':False,'featureSelection':cfg.get('featureSelection'),'orchestratorPython':platform.python_version(),'helperScriptSha256':{name:sha(HERE/name) for name in ('beat_engine.py','embedding_engine.py','stem_engine.py','structure_engine.py','bar_phase.py','resonance_essentia.py','loop_engine.py','vocal_presence.py','tempo_summary.py','dbn_decoder.py','genre_profiles.py','phrase_fusion.py')},'ffmpegSha256':sha(cfg['ffmpeg']),'ffmpegVersion':subprocess.check_output([cfg['ffmpeg'],'-version'],stderr=subprocess.STDOUT).decode().splitlines()[0]},'limitations':['Independentenginesandnewheuristics,differencesfromRekordboxexpected','Candidateonly; noimported/native/manualresultsareoverwritten','Scoresarenotcalibratedconfidence; eachfeaturestatessemantics']};env=os.environ.copy();env.update(HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false')
 base_artifacts=out
 if a.reuse_candidate:
  base_path=a.reuse_candidate.resolve(strict=True);base=json.load(open(base_path))
  if base.get('sourceKind')!='independent-candidate' or base.get('audioIdentity')!=identity:raise ValueError('Reusedcandidateaudioidentity mismatch')
  if base.get('scope',{}).get('requestedSeconds')!=a.seconds:raise ValueError('Reusedcandidateanalysisscope mismatch')
  base_artifacts=base_path.parent
  if not (base_artifacts/'stems').is_dir() and base.get('artifactRoots',{}).get('baseCandidate'):base_artifacts=pathlib.Path(base['artifactRoots']['baseCandidate']).resolve(strict=True)
  new_provenance=doc['provenance'];new_provenance['reusedBaseCandidate']={'document':str(base_path),'sha256':sha(base_path),'provenance':base.get('provenance')};doc=base;doc['provenance']=new_provenance;doc['artifactRoots']={'baseCandidate':str(base_artifacts)}
 def budget():
  remaining=float(cfg.get('overallTimeoutSeconds',600))-(time.time()-start)
  if remaining<=0:raise TimeoutError('Overallcandidateanalysisdeadline exceeded')
  return min(float(cfg.get('timeoutSeconds',600)),remaining)
 def save(): (out/'analysis.json').write_text(json.dumps(doc,indent=2,allow_nan=False))
 def record(name,status,result=None,reason=None):
  doc['featureAvailability'][name]=status;doc['features'][name]={'status':status,'result':result} if result is not None else {'status':status,'reason':reason};save()
 if a.refresh_dj_only:
  if not all(doc['featureAvailability'].get(name)=='available' for name in ['beats','stems','semanticPhrases']):raise ValueError('DJ refresh requires cached beat, stem and musical-model evidence')
  automatic_dj(doc,cfg,base_artifacts,out,budget());save();return
 if not a.reuse_candidate:
  for engine in ['beats','embedding','key','waveform','energy','loudness']:
   settings=cfg.get(engine,{})
   if settings.get('enabled',engine in ('waveform','energy','loudness')) is False:record(engine,'unavailable',reason='Disabledinexplicitconfiguration');continue
   runtime=settings.get('python',cfg.get('python',sys.executable));dest=out/(engine+'.json');worker_env=env.copy()
   if settings.get('pythonPath'):worker_env['PYTHONPATH']=settings['pythonPath']
   try:
    if engine=='beats' and not pathlib.Path(settings.get('checkpoint','')).is_file():raise FileNotFoundError('ExplicitlocalBeatThischeckpointmissing')
    if engine=='embedding' and not pathlib.Path(settings.get('snapshot','')).is_dir():raise FileNotFoundError('ExplicitlocalCLAPsnapshotmissing')
    run=run_owned([runtime,str(pathlib.Path(__file__).resolve()),str(audio),'--config',str(a.config.resolve()),'--output-dir',str(dest),'--engine',engine]+(['--seconds',str(a.seconds)] if a.seconds else []),worker_env,budget())
    (out/(engine+'.log')).write_bytes(run.stderr)
    if run.returncode:raise RuntimeError(f'{engine}processfailedexit{run.returncode};see{engine}.log')
    result=json.load(open(dest));record(engine,'available',result)
    if engine=='waveform':doc['durationSeconds']=result['durationSeconds']
    elif engine in ('beats','embedding') and doc['durationSeconds'] is None:doc['durationSeconds']=result.get('duration_seconds')
   except FileNotFoundError as e:record(engine,'unavailable',reason=str(e))
   except Exception as e:record(engine,'failed',reason=str(e))
  # Structureusesonlyindependentlydetectedbeats; neverborrow animportedgrid.
  try:
   if not cfg.get('structure',{}).get('enabled',False):raise FileNotFoundError('Disabledinexplicitconfiguration')
   if doc['featureAvailability']['beats']!='available':raise FileNotFoundError('Independentbeatgrid unavailable')
   budget()
   from structure_engine import analyze_structure
   audio48=decode(audio,cfg['ffmpeg'],48000,a.seconds);structure_result=analyze_structure(audio48,48000,doc['features']['beats']['result']['beats_seconds'])
   if not cfg.get('cues',{}).get('enabled',True):structure_result['cue_proposals']=[]
   record('structure','available',structure_result)
  except FileNotFoundError as e:record('structure','unavailable',reason=str(e))
  except Exception as e:record('structure','failed',reason=str(e))
  if cfg.get('genre',{}).get('enabled',True) and doc['featureAvailability'].get('embedding')=='available' and doc['features']['embedding']['result'].get('text_cosines'):
   embedding=doc['features']['embedding']['result'];record('genre','available',{'engine':'CLAP-text-cosines','scores':embedding.get('genre_text_cosines',embedding.get('text_cosines',[])),'promptProfile':embedding.get('genre_prompt_profile','canonical'),'confidence':None,'semantics':'Promptscoressimilarities,newmodelspace; notRekordbox63classlabelsorgenreaccuracy'})
  else:record('genre','unavailable',reason='Independentembedding/textpromptsunavailable')
  if doc['featureAvailability'].get('structure')=='available':
   structure=doc['features']['structure']['result'];record('phrases','available',{'engine':'Independentstructureheuristic','sections':structure['sections'],'confidence':None,'semantics':'GenericSectionNboundaries,semantic_typeNone; notIntro/Verse/Chorusclassification'});record('cues','available',{'engine':'Independentstructureheuristic','cueProposals':structure['cue_proposals'],'confidence':None,'semantics':'Proposalsonly,notwrittenhotcuesandnotRekordboxIntelligentCueparity'})
  else:
   record('phrases','unavailable',reason='Independentstructureunavailable');record('cues','unavailable',reason='Independentstructureunavailable')
  settings=cfg.get('stems',{})
  try:
   if not settings.get('enabled',False):raise FileNotFoundError('Disabledinexplicitconfiguration')
   if settings.get('engine','spleeter')=='htdemucs':
    adapter=HERE/'demucs_adapter.py';stem_env=env.copy()
    if settings.get('pythonPath'):stem_env['PYTHONPATH']=settings['pythonPath']
    cmd=[settings['python'],str(adapter),str(audio),'--output',str(out/'stems'),'--ffmpeg',cfg['ffmpeg'],'--model-root',settings['modelRoot']]+(['--seconds',str(a.seconds)] if a.seconds else [])
    run=run_owned(cmd,stem_env,budget());(out/'stems.log').write_bytes(run.stderr)
    if run.returncode:raise RuntimeError('HTDemucs failed; see stems.log')
    manifest=json.load(open(out/'stems/manifest.json'))
    if manifest['audioSha256']!=identity['sha256']:raise ValueError('HTDemucs source identity mismatch')
    doc['provenance']['helperScriptSha256']['demucs_adapter.py']=sha(adapter)
    record('stems','available',manifest)
   elif settings.get('engine','spleeter')=='spleeter':
    root=pathlib.Path(settings.get('modelRoot',''))
    if not (root/'4stems/model.index').is_file():raise FileNotFoundError('ExplicitlocalSpleetercheckpointmissing')
    segment_seconds=float(settings.get('segmentSeconds',30));duration=doc['durationSeconds']
    if not 5<=segment_seconds<=120:raise ValueError('StemsegmentSeconds mustbe5..120')
    if duration is None:raise FileNotFoundError('Boundedstemseparationrequiresdecoded duration')
    manifests=[];segments=[];stem_start=time.time()
    for number,offset in enumerate(__import__('numpy').arange(0,duration,segment_seconds)):
     length=min(segment_seconds,duration-float(offset));segment_file=out/f'stem-input-{number:04d}.wav'
     subprocess.run([cfg['ffmpeg'],'-v','error','-ss',str(float(offset)),'-i',str(audio),'-t',str(length),'-ar','44100','-ac','2','-c:a','pcm_f32le',str(segment_file)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
     segment_out=out/f'stem-segment-{number:04d}';cmd=[settings['python'],str(HERE/'stem_engine.py'),str(segment_file),'--model-root',str(root),'--output',str(segment_out),'--ffmpeg',cfg['ffmpeg']]
     run=run_owned(cmd,env,budget());(out/f'stem-segment-{number:04d}.log').write_bytes(run.stderr)
     if run.returncode:raise RuntimeError(f'Stemsegment{number}failed;seesegmentlog')
     manifest=json.load(open(segment_out/'manifest.json'));manifests.append(manifest);segments.append({'startSeconds':float(offset),'durationSeconds':length,'manifest':str(segment_out.relative_to(out)/'manifest.json')});segment_file.unlink()
    final=out/'stems';final.mkdir();stem_rows={}
    for name in ('vocals','drums','bass','other'):
     concat=out/f'{name}-concat.txt';concat.write_text(''.join('file '+json.dumps(str((out/f'stem-segment-{i:04d}'/(name+'.wav')).resolve()))+'\n' for i in range(len(segments))).replace('"',"'"))
     dest=final/(name+'.wav');subprocess.run([cfg['ffmpeg'],'-v','error','-f','concat','-safe','0','-i',str(concat),'-c:a','pcm_f32le',str(dest)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE);concat.unlink();expected=wav_pcm_identity([out/f'stem-segment-{i:04d}'/(name+'.wav') for i in range(len(segments))]);actual=wav_pcm_identity([dest])
     if expected!=actual:raise ValueError('JoinedstemPCMidentitymismatch')
     stem_rows[name]={'file':dest.name,'sha256':sha(dest),'bytes':dest.stat().st_size,**actual}
    retained=final/'segment-manifests';retained.mkdir()
    for i,(segment,manifest) in enumerate(zip(segments,manifests)):
     retained_path=retained/f'{i:04d}.json';retained_path.write_text(json.dumps(manifest,indent=2));segment['manifest']=str(retained_path.relative_to(out));shutil.rmtree(out/f'stem-segment-{i:04d}')
    stem_manifest={'temporarySegmentAudioRemovedAfterPcmVerification':True,'totalStemAudioBytes':sum(x['bytes'] for x in stem_rows.values()),'engine':'spleeter:4stems-segmented','sourceSha256':identity['sha256'],'sampleRate':44100,'channels':2,'encoding':'float32WAV','durationSeconds':duration,'segmentSeconds':segment_seconds,'segments':segments,'stems':stem_rows,'checkpointFiles':manifests[0]['checkpointFiles'],'inferenceSeconds':time.time()-stem_start,'limitations':['Independentboundedsegmentseparation; nocrossfade/overlap;segmentseamsmayaffectquality','NotexactRekordboxstemparity; notfullcontextSpleeterseparation']};(final/'manifest.json').write_text(json.dumps(stem_manifest,indent=2));record('stems','available',stem_manifest)
   else:raise ValueError('Unsupported independent stem engine')
  except FileNotFoundError as e:record('stems','unavailable',reason=str(e))
  except Exception as e:record('stems','failed',reason=str(e))
  try:
   if not cfg.get('vocalActivity',{}).get('enabled',True):raise FileNotFoundError('Notselectedinexplicitconfiguration')
   if doc['featureAvailability']['stems']!='available':raise FileNotFoundError('Separatedvocalaudiounavailable')
   import numpy as np
   vocals=decode(out/'stems/vocals.wav',cfg['ffmpeg'],22050,None);mix=decode(audio,cfg['ffmpeg'],22050,a.seconds);bins=[]
   for i in range(0,min(len(vocals),len(mix)),22050):
    vr=float(np.sqrt(np.mean(vocals[i:i+22050].astype(float)**2)));mr=float(np.sqrt(np.mean(mix[i:i+22050].astype(float)**2)));bins.append({'startSeconds':i/22050,'vocalRms':vr,'vocalRmsDbfs':float(20*np.log10(max(vr,1e-12))),'vocalToMixtureRmsRatio':vr/max(mr,1e-12)})
   record('vocalActivity','available',{'engine':doc['features']['stems']['result']['engine']+'-vocal-RMS','windowSeconds':1,'bins':bins,'confidence':None,'semantics':'Measuredseparatedvocalenergy,notRekordboxvocalpresenceclassifier; nostate/thresholdaccuracyclaim'})
  except FileNotFoundError as e:record('vocalActivity','unavailable',reason=str(e))
  except Exception as e:record('vocalActivity','failed',reason=str(e))
 for derived in ('genre','phrases','cues','vocalActivity'):
  if not cfg.get(derived,{}).get('enabled',True):record(derived,'unavailable',reason='Disabled in explicit configuration')
 settings=cfg.get('semanticPhrases',{})
 try:
  if not settings.get('enabled',False):raise FileNotFoundError('Disabledinexplicitconfiguration')
  if doc['featureAvailability'].get('stems')!='available':raise FileNotFoundError('Independentseparatedstemsunavailable')
  adapter=pathlib.Path(settings['adapter']).resolve(strict=True);source_root=pathlib.Path(settings['sourceRoot']).resolve(strict=True);checkpoint=pathlib.Path(settings['checkpoint']).resolve(strict=True);stem_dir=base_artifacts/'stems'
  for name,row in doc['features']['stems']['result']['stems'].items():
   if sha(stem_dir/(name+'.wav'))!=row['sha256']:raise ValueError('Reusedstemartifactidentity mismatch')
  expected=settings.get('checkpointSha256')
  if expected and sha(checkpoint)!=expected:raise ValueError('Semanticcheckpointidentity mismatch')
  doc['provenance']['helperScriptSha256']['optionalSemanticAdapter']=sha(adapter)
  semantic_path=out/'semantic-phrases.json';cmd=[settings['python'],str(adapter),'--source-root',str(source_root),'--checkpoint',str(checkpoint),'--stems-dir',str(stem_dir),'--ffmpeg',cfg['ffmpeg'],'--output',str(semantic_path)]
  if settings.get('ensembleManifest'):cmd+=['--ensemble-manifest',settings['ensembleManifest']]
  run=run_owned(cmd,env,budget());(out/'semantic-phrases.log').write_bytes(run.stderr)
  if run.returncode:raise RuntimeError('Optionalsemanticprocessfailed;seesemantic-phrases.log')
  semantic=json.load(open(semantic_path))
  if semantic.get('status')!='success':raise RuntimeError('Optionalsemanticadaptererror:'+str(semantic.get('message','unknown')))
  duration=doc['durationSeconds'];adjustments=[];semantic['raw_segments']=json.loads(json.dumps(semantic['segments']))
  for i,segment in enumerate(semantic['segments']):
   start_sec=float(segment['start_seconds']);end_sec=float(segment['end_seconds'])
   if not (0<=start_sec<end_sec<=duration+.1):raise ValueError('Invalidsemanticsegmenttime')
   if end_sec>duration:adjustments.append({'segment':i,'rawEndSeconds':end_sec,'overlayEndSeconds':duration});segment['end_seconds']=duration
  semantic.update(engine=semantic.get('engine','AllInOne-functional-segmentation'),experimental=True,timing_resolution_seconds=.01,segmentTimeAdjustments=adjustments,stem_engine=doc['features']['stems']['result']['engine'],limitations=['Independent separated stem input; float WAV without per-stem rescaling','SemanticlabelsnotRekordboxphraseparity; noaccuracyorconfidenceclaim','Raw100fpstimestampsretained; overlayendclippedonlytoexplicitdecodedaudioduration'])
  if settings.get('djProfile',False):
   from secondary_profiles import dj_structure,percussion_bins
   doc['provenance']['helperScriptSha256']['secondary_profiles.py']=sha(HERE/'secondary_profiles.py')
   semantic['djStructure']=dj_structure(semantic['segments'],percussion_bins(stem_dir/'drums.wav',cfg['ffmpeg']),duration,percussion_bins(stem_dir/'bass.wav',cfg['ffmpeg']))
  record('semanticPhrases','available',semantic)
  if cfg.get('phrases',{}).get('fuseSemanticBoundaries',False) and cfg.get('phrases',{}).get('enabled',True) and doc['featureAvailability'].get('structure')=='available':
   from phrase_fusion import fuse_sections
   record('phrases','available',fuse_sections(doc['features']['structure']['result']['sections'],semantic['segments'],duration))
 except FileNotFoundError as e:record('semanticPhrases','unavailable',reason=str(e))
 except Exception as e:record('semanticPhrases','failed',reason=str(e))
 # Optional full-analysis refinement needs both independent activation grids.
 if cfg.get('beats',{}).get('enabled',True) and cfg.get('beats',{}).get('consensusWeight',0)>0 and doc['featureAvailability'].get('beats')=='available' and doc['featureAvailability'].get('semanticPhrases')=='available':
  grid=doc['features']['beats']['result'];semantic=doc['features']['semanticPhrases']['result'];frame_path=out/'beat-frame-scores.json';activation_path=out/semantic.get('activationsArtifact','missing.npz')
  if frame_path.is_file() and activation_path.is_file():
   decoder=HERE/'consensus_decoder.py';dest=out/'consensus-beats.json';cmd=[cfg['beats']['dbnPython'],str(decoder),'--beatthis',str(frame_path),'--allinone',str(activation_path),'--weight',str(cfg['beats']['consensusWeight']),'--output',str(dest)];run=run_owned(cmd,env,budget());(out/'consensus-beats.log').write_bytes(run.stderr)
   if run.returncode:raise RuntimeError('Consensus decoder failed; see consensus-beats.log')
   grid['raw_beatthis_dbn_grid']={k:grid[k] for k in ('beats_seconds','downbeats_seconds','bpm_median_interval','bpm_whole_span')};grid.update(json.load(open(dest)))
   from tempo_summary import summarize_tempo
   import numpy as np
   beats=np.asarray(grid['beats_seconds']);grid.update(summarize_tempo(beats));grid['bpm_median_interval']=float(60/np.median(np.diff(beats))) if len(beats)>1 else None;grid['bpm_whole_span']=float(60*(len(beats)-1)/(beats[-1]-beats[0])) if len(beats)>1 else None;grid['consensusDecoderSha256']=sha(decoder);grid['allInOneActivationsSha256']=sha(activation_path);record('beats','available',grid);doc['provenance']['helperScriptSha256']['consensus_decoder.py']=sha(decoder)
   if cfg.get('structure',{}).get('enabled',False):
    from structure_engine import analyze_structure
    structure=analyze_structure(decode(audio,cfg['ffmpeg'],48000,a.seconds),48000,grid['beats_seconds']);record('structure','available',structure)
    if cfg.get('cues',{}).get('enabled',True):record('cues','available',{'engine':'Independentstructureheuristic','cueProposals':structure['cue_proposals'],'confidence':None,'semantics':'Proposals only; recomputed on consensus grid'})
    if cfg.get('phrases',{}).get('enabled',True):
     from phrase_fusion import fuse_sections
     phrases=fuse_sections(structure['sections'],semantic['segments'],doc['durationSeconds']) if cfg.get('phrases',{}).get('fuseSemanticBoundaries',False) else {'engine':'Independentstructureheuristic','sections':structure['sections'],'confidence':None}
     record('phrases','available',phrases)
  else:grid['consensusStatus']='not-run: both activation artifacts required'
 # Automatic DJ arrangement runs on the final consensus grid and measured stems.
 # Genre routing is a hint; unknown genre uses the generic acoustic profile.
 if doc['featureAvailability'].get('semanticPhrases')=='available' and doc['featureAvailability'].get('beats')=='available':
  semantic=doc['features']['semanticPhrases']['result']
  if 'djStructure' in semantic:
   try:
    automatic_dj(doc,cfg,base_artifacts,out,budget())
    record('semanticPhrases','available',semantic)
   except Exception as error:
    # Keep the prior complete result and expose the fallback. An optional acoustic
    # refinement failure must not discard beats, vocals or the musical model.
    semantic['djStructure']['automaticFallback']={'reason':type(error).__name__,'stage':'genre-arrangement'}
    record('semanticPhrases','available',semantic)
 for name in ('loops','vocalPresence'):
  settings=cfg.get(name,{})
  try:
   if not settings.get('enabled',False):raise FileNotFoundError('Disabled in explicit configuration')
   budget()
   if name=='loops':
    if doc['featureAvailability'].get('beats')!='available':raise FileNotFoundError('Independent beat grid unavailable')
    from loop_engine import propose_loops
    beat_result=doc['features']['beats']['result'];loop_audio=decode(audio,cfg['ffmpeg'],22050,a.seconds)
    result=propose_loops(loop_audio,22050,beat_result['beats_seconds'],beat_result['downbeats_seconds'],beat_counts=settings.get('beatCounts',[4,8,16,32]),max_loops=settings.get('maxLoops',12),min_rms_dbfs=settings.get('minRmsDbfs',-45))
   elif settings.get('engine')=='singing-voice':
    dest=out/'singing-presence.json';helper=HERE/'singing_engine.py';cmd=[settings.get('python',cfg['python']),str(helper),str(audio),'--checkpoint',settings['checkpoint'],'--ffmpeg',cfg['ffmpeg'],'--output',str(dest),'--on',str(settings.get('onScore',.9)),'--off',str(settings.get('offScore',.54))]+(['--seconds',str(a.seconds)] if a.seconds else [])
    run=run_owned(cmd,env,budget());(out/'singing-presence.log').write_bytes(run.stderr)
    if run.returncode:raise RuntimeError('Singing-voice process failed; see singing-presence.log')
    result=json.load(open(dest));doc['provenance']['helperScriptSha256']['singing_engine.py']=sha(helper);doc['provenance']['helperScriptSha256']['optional-singing/model.py']=sha(HERE/'optional-singing/model.py')
   else:
    if doc['featureAvailability'].get('vocalActivity')!='available':raise FileNotFoundError('Independent vocal energy unavailable')
    from vocal_presence import detect_presence
    activity=doc['features']['vocalActivity']['result']
    result=detect_presence(activity['bins'],doc['durationSeconds'],activity['windowSeconds'],on_dbfs=settings.get('onDbfs',-40),off_dbfs=settings.get('offDbfs',-45),on_ratio=settings.get('onRatio',.25),off_ratio=settings.get('offRatio',.15),min_presence_seconds=settings.get('minPresenceSeconds',2),max_gap_seconds=settings.get('maxGapSeconds',1))
   if name=='vocalPresence' and settings.get('processedVoice',{}).get('enabled',False):
    secondary=settings['processedVoice'];helper=HERE/'processed_voice_engine.py';dest=out/'processed-voice.json'
    try:
     cmd=[secondary.get('python',cfg['python']),str(helper),str(base_artifacts/'stems/vocals.wav'),'--checkpoint',secondary['checkpoint'],'--sha256',secondary['checkpointSha256'],'--ffmpeg',cfg['ffmpeg'],'--output',str(dest)]
     run=run_owned(cmd,env,budget());(out/'processed-voice.log').write_bytes(run.stderr)
     if run.returncode:raise RuntimeError('Secondary voice process failed')
     secondary_result=json.load(open(dest))
     from secondary_profiles import processed_voice
     result['processedVoice']=processed_voice([b['speechScore'] for b in secondary_result['bins']],secondary_result['durationSeconds'],secondary_result.get('identity'),result['bins']);doc['provenance']['helperScriptSha256']['processed_voice_engine.py']=sha(helper)
    except Exception as e:result['processedVoice']={'status':'unavailable','reason':str(e)}
   record(name,'available',result)
  except FileNotFoundError as e:record(name,'unavailable',reason=str(e))
  except Exception as e:record(name,'failed',reason=str(e))
 selection=cfg.get('featureSelection')
 if selection:
  for name in list(doc['featureAvailability']):
   if name not in selection['requiredIncludingDependencies']:record(name,'skipped',reason='Not selected; no result generated')
 if sha(audio)!=identity['sha256']:raise RuntimeError('Sourceaudiochangedwhileanalyzing')
 doc['elapsedSeconds']=time.time()-start;doc['peakLargestChildRssBytes']=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss if sys.platform=='darwin' else resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss*1024;doc['peakMemoryScope']='LargestterminatedchildRSS,notaggregateconcurrentpeak';doc['status']='complete-with-gaps' if any(x not in ('available','skipped') for x in doc['featureAvailability'].values()) else 'complete';save();print(json.dumps({'status':doc['status'],'output':str(out/'analysis.json')}))
if __name__=='__main__':main()
