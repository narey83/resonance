from pathlib import Path
import json,tempfile,unittest,wave
from anlz_writer import path_for_audio,encode_beats,write_anlz,resample
from usb_export import prepare,export_key,sha
from pyrekordbox.anlz import AnlzFile
class FormatTests(unittest.TestCase):
 def test_grid_preserves_phase_and_variable_tempo(self):
  _,ticks=encode_beats([.25,.75,1.25,1.75,2.25,2.65],[.25,2.25]);self.assertEqual([t[0] for t in ticks],[1,2,3,4,1,2]);self.assertEqual(ticks[0][2],250);self.assertEqual(ticks[4][1],15000)
 def test_key_aliases_share_canonical_pioneer_ids(self):
  self.assertEqual(export_key('G#m'),'Abm');self.assertEqual(export_key('1A'),'Abm');self.assertEqual(export_key('12A'),'Dbm')
 def test_unknown_phase_rejected(self):
  with self.assertRaises(ValueError):encode_beats([.25,.75],[])
 def test_anlz_independent_readback(self):
  analysis={'features':{'beats':{'result':{'beats_seconds':[.25,.75,1.25,1.75],'downbeats_seconds':[.25]}},'waveform':{'result':{'overallPeaks':[.1,.5,.9,.2],'bands':{'low':[.1,.4,.2,.7],'mid':[.7,.1,.3,.2],'high':[.4,.8,.2,.1]}}}}}
  with tempfile.TemporaryDirectory() as temp:
   audio='/Contents/Resonance/test.wav';track={'usbPath':audio,'anlzPath':path_for_audio(audio),'durationSeconds':2};result=write_anlz(temp,track,analysis);path=Path(temp)/track['anlzPath'].lstrip('/');dat=AnlzFile.parse_file(path);ext=AnlzFile.parse_file(path.with_suffix('.EXT'));two=AnlzFile.parse_file(path.with_suffix('.2EX'));self.assertEqual(result['beatCount'],4);self.assertEqual(dat.get_tag('PWAV').content.len_preview,400);self.assertEqual(ext.get_tag('PWV4').content.len_entries,1200);self.assertEqual(two.get_tag('PWV7').content.len_entries,300)
 def test_existing_destination_refused_before_source_access(self):
  with tempfile.TemporaryDirectory() as temp:
   with self.assertRaises(FileExistsError):prepare({},temp,'dual','unused')
 def test_network_profile_contains_analysis_but_no_audio(self):
  with tempfile.TemporaryDirectory() as temp:
   source=Path(temp)/'source.wav'
   with wave.open(str(source),'wb') as out:
    out.setnchannels(2);out.setsampwidth(2);out.setframerate(44100);out.writeframes(b'\0'*(44100*4))
   analysis={'scope':{'fullTrack':True},'durationSeconds':1.0,'featureAvailability':{'beats':'available','key':'available','waveform':'available'},'features':{'beats':{'result':{'bpm_median_interval':120,'beats_seconds':[0,.5],'downbeats_seconds':[0]}},'key':{'result':{'key':'Am'}},'genre':{'result':{'scores':[{'label':'House','cosine':1}]}},'waveform':{'result':{'overallPeaks':[.1,.5],'bands':{'low':[.1,.4],'mid':[.7,.1],'high':[.4,.8]}}}}}
   manifest={'schemaVersion':1,'tracks':[{'id':1,'sourceKey':'a'*64,'sourcePath':str(source),'sourceSha256':sha(source),'sourceBytes':source.stat().st_size,'title':'Stream only','artist':'Artist','analysis':analysis}]}
   destination=Path(temp)/'out';result=prepare(manifest,destination,'network','unused')
   self.assertEqual(result['profile'],'network');self.assertEqual(len(result['streams']),1)
   self.assertFalse((destination/'Contents').exists())
   self.assertTrue((destination/'PIONEER/rekordbox/export.pdb').is_file())
   saved=json.loads((destination/'export-manifest.json').read_text())
   self.assertEqual(saved['streams'][0]['sourceKey'],'a'*64)
if __name__=='__main__':unittest.main()
