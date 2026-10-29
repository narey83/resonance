"""Optional offline experiment: author All-In-One + caller's Spleeter stems.
Bypasses public allin1.analyze and its Demucs/madmom paths entirely.
Distribution shift: pretrainedHTDemucs inputs replaced by Spleeter4stems.
NumPy spectrogram implementation has not been numerically matched to madmom.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,sys,types,time,traceback
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
import numpy as np
from runtime_resources import configure_torch
LABELS=['start','end','intro','outro','break','bridge','inst','solo','verse','chorus']
STEMS=['bass','drums','other','vocals']

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def filterbank():
    # Mathematical specification from author frontend and madmomlogfilterbank.
    frequencies=440*2**(np.arange(np.floor(12*np.log2(30/440)),np.ceil(12*np.log2(17000/440)))/12)
    frequencies=frequencies[(frequencies>=30)&(frequencies<=17000)]
    bins=np.unique(np.floor(frequencies/(44100/2048)+.5).astype(int))
    matrix=np.zeros((1024,len(bins)-2),dtype=np.float32)
    for j,(a,b,c) in enumerate(zip(bins,bins[1:],bins[2:])):
        matrix[a:b,j]=np.arange(b-a)/(b-a)
        matrix[b:c,j]=1-np.arange(c-b)/(c-b)
        matrix[:,j]/=matrix[:,j].sum()
    if matrix.shape!=(1024,81):raise ValueError('Unexpectedfrontendshape '+str(matrix.shape))
    return matrix

def spectrogram(audio):
    x=np.asarray(audio,dtype=np.float32)
    if x.ndim!=1 or not len(x) or not np.isfinite(x).all():raise ValueError('Finite nonempty44100Hzmonoaudio required')
    # Centeredframes at0,441,..; zeroedges. Exactmadmomframecount pendingcomparison.
    frames=int(np.ceil(len(x)/441));padded=np.pad(x,(1024,2048))
    view=np.lib.stride_tricks.sliding_window_view(padded,2048)[::441][:frames]
    matrix=filterbank();out=[];window=np.hanning(2048).astype(np.float32)
    for start in range(0,len(view),512):
        magnitude=np.abs(np.fft.rfft(view[start:start+512]*window,axis=1)[:,:1024]).astype(np.float32)
        out.append(np.log10(1+magnitude@matrix))
    return np.vstack(out).astype(np.float32)

def load_author_model(source_root,checkpoint):
    # Createpackage namespaceswithoutexecutingeager __init__ (importsDemucs).
    source=Path(source_root)/'src/allin1'
    for name,path in [('allin1',source),('allin1.models',source/'models')]:
        package=types.ModuleType(name);package.__path__=[str(path)];sys.modules[name]=package
    from allin1.models.allinone import AllInOne
    from omegaconf import OmegaConf
    import torch
    # Authorexplicitlocalfile; safeweights-onlydeserialization, noautomaticdownload.
    data=torch.load(checkpoint,map_location='cpu',weights_only=True)
    cfg=OmegaConf.create(data['config']);model=AllInOne(cfg)
    model.load_state_dict(data['state_dict'],strict=True);model.eval()
    return model,cfg

def functional_segments(output,cfg):
    import torch
    boundary=torch.sigmoid(output.logits_section[0]).detach().cpu().numpy()
    probabilities=torch.softmax(output.logits_function[0],dim=0).detach().cpu().numpy()
    radius=2*int(cfg.min_hops_per_beat)
    padded=np.pad(boundary,(radius,radius),constant_values=-np.inf)
    maxima=boundary==np.lib.stride_tricks.sliding_window_view(padded,2*radius+1).max(axis=1)
    filtered=np.where(maxima,boundary,0)
    half=12*int(cfg.fps)
    context=np.pad(filtered,(half,half))
    selected=(filtered>0)&(filtered==np.lib.stride_tricks.sliding_window_view(context,2*half+1).max(axis=1))
    # Authorpeakpicking strengthmustpositive; meansexcludecurrentframe.
    sums=np.r_[0,np.cumsum(context,dtype=np.float64)]
    index=np.arange(len(filtered))
    past=(sums[index+half]-sums[index])/half
    future=(sums[index+2*half+1]-sums[index+half+1])/half
    selected&=(filtered-(past+future)/2)>0
    indices=np.unique(np.r_[0,np.flatnonzero(selected),len(boundary)])
    return [{'start_seconds':float(a*cfg.hop_size/cfg.sample_rate),'end_seconds':float(b*cfg.hop_size/cfg.sample_rate),'label':LABELS[int(probabilities[:,a:b].mean(axis=1).argmax())],'label_status':'experimental-model-prediction-distribution-shift'} for a,b in zip(indices[:-1],indices[1:]) if b>a]

def main():
    p=argparse.ArgumentParser();p.add_argument('--source-root',required=True);p.add_argument('--checkpoint',required=True);p.add_argument('--stems-dir',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    path=Path(a.output)
    if path.exists():p.error('Choose newoutputpath; existingresults preserved')
    report={'status':'started','experiment':'authorAllInOnefunctional-onlywithSpleeter4stems','distribution_shift':['HTDemucs training/inferencefrontend replaced bySpleeter4stems','IndependentNumPylogfilterbank/STFT frontend notyetnumericallyvalidatedagainstauthorMadmomDSP'],'limitations':['Labels are modelpredictions, notgroundtruth orRekordboxparity','Noqualityclaim untilmusicalevaluation','NoDemucsorMadmommodelsloaded/downloaded','Originalaudio spectrogram isnotinputtoauthorfour-stemmodel'],'sources':['https://github.com/mir-aidj/all-in-one','https://huggingface.co/taejunkim/allinone']}
    started=time.perf_counter()
    try:
        specs=[];hashes={}
        for name in STEMS:
            wav=Path(a.stems_dir)/(name+'.wav');hashes[name]=digest(wav)
            cmd=[a.ffmpeg,'-v','error','-i',str(wav),'-ac','1','-ar','44100','-f','f32le','-']
            raw=subprocess.run(cmd,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120).stdout
            specs.append(spectrogram(np.frombuffer(raw,dtype='<f4')))
        if len({s.shape for s in specs})!=1:raise ValueError('Stemshape mismatch')
        spec=np.stack(specs);report.update(input_shape=list(spec.shape),stem_sha256=hashes,checkpoint_sha256=digest(a.checkpoint))
        import torch
        configure_torch(torch);model,cfg=load_author_model(a.source_root,a.checkpoint)
        with torch.inference_mode():output=model(torch.from_numpy(spec).unsqueeze(0))
        if not torch.isfinite(output.logits_function).all():raise ValueError('Nonfinitemodeloutput')
        report.update(status='success',segments=functional_segments(output,cfg),torch_version=torch.__version__,model_config=dict(cfg),source_files_sha256={str(f.relative_to(a.source_root)):digest(f) for f in (Path(a.source_root)/'src/allin1').rglob('*.py')})
    except Exception as e:report.update(status='error',error=str(e),traceback=traceback.format_exc())
    report['elapsed_seconds']=time.perf_counter()-started;report['adapter_sha256']=digest(__file__)
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x') as f:json.dump(report,f,indent=2,default=str)
    print(json.dumps({'status':report['status'],'error':report.get('error'),'output':str(path)}))
if __name__=='__main__':main()
