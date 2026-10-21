"""Independent ANLZ encoder against documented pyrekordbox/Deep Symmetry layouts."""
from pathlib import Path
import struct,math
import numpy as np

def tag(kind, header, payload=b''):
 return kind.encode('ascii')+struct.pack('>II',12+len(header),12+len(header)+len(payload))+header+payload

def file_bytes(tags):
 body=b''.join(tags);return b'PMAI'+struct.pack('>II',28,28+len(body))+struct.pack('>IIII',1,0x10000,0x10000,0)+body

def path_for_audio(usb_path):
 # Observed polynomial and bucket bit selection are file-format facts.
 value=0
 for byte in usb_path.encode('ascii'):value=(value*(0x5bc9*0x93b5)+byte*(0x93b5+1))&0xffffffff
 value%=200003;bucket=sum(((value>>source)&1)<<dest for dest,source in enumerate([0,2,6,7,9,13,16]))
 return f'/PIONEER/USBANLZ/P{bucket:03X}/{value:08X}/ANLZ0000.DAT'

def resample(values,count):
 values=np.asarray(values,dtype=float)
 if not len(values) or not np.isfinite(values).all():raise ValueError('Finite waveform coverage required')
 edges=np.linspace(0,len(values),count+1)
 return np.asarray([float(np.max(values[min(len(values)-1,int(a)):max(min(len(values),math.ceil(b)),min(len(values)-1,int(a))+1)])) for a,b in zip(edges,edges[1:])])

def encode_beats(beats,downbeats):
 if len(beats)<2 or any(not math.isfinite(v) or v<0 for v in beats) or any(b<=a for a,b in zip(beats,beats[1:])):raise ValueError('Ascending finite beat grid required')
 anchors=sorted(set(int(np.argmin(np.abs(np.asarray(beats)-d))) for d in downbeats))
 if not anchors:raise ValueError('Downbeats required; never invent bar phase')
 ticks=[]
 for i,time in enumerate(beats):
  before=[a for a in anchors if a<=i];anchor=before[-1] if before else anchors[0];after=next((a for a in anchors if a>anchor),None)
  meter=after-anchor if after is not None and 1<=after-anchor<=4 else 4
  bar=(i-anchor)%meter+1;interval=beats[i+1]-time if i+1<len(beats) else time-beats[i-1]
  tempo=max(1,min(65535,round(6000/interval)));ticks.append((bar,tempo,round(time*1000)))
 return tag('PQTZ',struct.pack('>III',0,0x80000,len(ticks)),b''.join(struct.pack('>HHI',*t) for t in ticks)),ticks

def write_anlz(root,track,analysis):
 from pyrekordbox.anlz import AnlzFile
 path=Path(root)/track['anlzPath'].lstrip('/');path.parent.mkdir(parents=True,exist_ok=True)
 beats=analysis['features']['beats']['result'];q,ticks=encode_beats(beats['beats_seconds'],beats['downbeats_seconds'])
 waveform=analysis['features']['waveform']['result'];overall=waveform['overallPeaks'];detail_count=max(1,round(track['durationSeconds']*150));height=np.clip(np.rint(resample(overall,detail_count)*31),0,31).astype('uint8');preview=np.clip(np.rint(resample(overall,400)*31),0,31).astype('uint8');tiny=np.clip(np.rint(resample(overall,100)*15),0,15).astype('uint8')
 pp=track['usbPath'].encode('utf-16-be')+b'\0\0';pt=tag('PPTH',struct.pack('>I',len(pp)),pp)
 memory=tag('PCOB',struct.pack('>IHHI',0,0,0,0));hot=tag('PCOB',struct.pack('>IHHI',1,0,0,0))
 dat=file_bytes([pt,q,tag('PWAV',struct.pack('>II',400,0x10000),preview.tobytes()),tag('PWV2',struct.pack('>II',100,0x10000),tiny.tobytes()),memory,hot])
 ext=file_bytes([pt,q,tag('PWV3',struct.pack('>III',1,len(height),0x00960000),height.tobytes()),memory,hot])
 bands=waveform.get('bands',{});names=['low','mid','high'];band_values=[]
 for name in names:
  value=bands.get(name)
  if isinstance(value,dict):value=value.get('peaks')
  if value is None:raise ValueError('Real three-band waveform required; colour placeholders refused')
  band_values.append(np.clip(np.rint(resample(value,detail_count)*255),0,255).astype('uint8'))
 colour=np.stack(band_values,axis=1);overview=np.stack([np.clip(np.rint(resample(bands[name],1200)*255),0,255).astype('uint8') for name in names],axis=1)
 rgb=np.clip(colour.astype(float)/255*7,0,7).round().astype('uint16');packed=(rgb[:,0]<<13)|(rgb[:,1]<<10)|(rgb[:,2]<<7)|(height.astype('uint16')<<2)
 rgb_preview=(overview.astype('uint16')//2).astype('uint8');six=np.column_stack([rgb_preview.max(axis=1),np.full(1200,127,dtype='uint8'),rgb_preview.max(axis=1),rgb_preview])
 ext=file_bytes([pt,q,tag('PWV3',struct.pack('>III',1,len(height),0x00960000),height.tobytes()),tag('PWV4',struct.pack('>III',6,1200,0),six.tobytes()),tag('PWV5',struct.pack('>III',2,len(height),0x00960305),packed.astype('>u2').tobytes()),memory,hot,tag('PCO2',struct.pack('>IHH',0,0,0)),tag('PCO2',struct.pack('>IHH',1,0,0))])
 two=file_bytes([pt,tag('PWV6',struct.pack('>II',3,1200),overview.tobytes()),tag('PWV7',struct.pack('>III',3,detail_count,0x00960000),colour.tobytes())])
 for dest,data in [(path,dat),(path.with_suffix('.EXT'),ext),(path.with_suffix('.2EX'),two)]:
  if dest.exists():raise FileExistsError(dest)
  dest.write_bytes(data);parsed=AnlzFile.parse_file(dest)
  if parsed.get_tag('PPTH').content.path!=track['usbPath']:raise ValueError('ANLZ path readback mismatch')
 parsed=AnlzFile.parse_file(path);entries=parsed.get_tag('PQTZ').content.entries
 if [(e.beat,e.tempo,e.time) for e in entries]!=ticks:raise ValueError('Beat grid readback mismatch')
 return {'beatCount':len(ticks),'detailFrames':detail_count,'hardwareVerified':False}
