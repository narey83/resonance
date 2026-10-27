#include "../studio-native/StudioDSP.h"
#include <cassert>
#include <limits>
#include <iostream>
using namespace resonance;
int main() {
  auto& c=controls();
  for(int mode=0;mode<4;mode++) {
    c.enabled=mode>0; c.pushed=mode==2; c.bypass=mode==3;
    for(auto& value:c.values) value=1;
    for(int rate:{44100,48000,96000,192000}) {
      StudioDSP dsp(rate);
      for(int block=0;block<200;block++) {
        dsp.begin();
        for(int i=0;i<256;i++) {
          float l=4*std::sin((block*256+i)*.043),r=-l*.7f;
          if(i==0) l=std::numeric_limits<float>::infinity();
          dsp.frame(l,r);
          assert(std::isfinite(l)&&std::isfinite(r));
          assert(std::abs(l)<=.891251f&&std::abs(r)<=.891251f);
        }
        dsp.end();
        assert(std::isfinite(c.reduction.load()));
      }
    }
  }
  c.enabled=false; c.bypass=false;
  StudioDSP clean; clean.begin(); float l=.1f,r=-.05f; clean.frame(l,r);
  assert(std::abs(l-.1f)<1e-6 && std::abs(r+.05f)<1e-6);
  // Controls default to protected mode; even bad native input is clamped there.
  assert(cap(Exciter,false)==.35f && cap(Exciter,true)==1.f);
  c.enabled=true; c.pushed=false; for(auto& v:c.values)v=0; c.values[Warmth]=.3f;
  StudioDSP warmth; warmth.begin(); l=.4f;r=.4f; for(int i=0;i<4800;i++) { l=.4f;r=.4f; warmth.frame(l,r); }
  assert(std::abs(l-.4f)>1e-4);
  // Every advertised module must alter actual samples, independently of the UI.
  for(int module=0;module<Count;module++) {
    c.enabled=true; c.pushed=false; c.bypass=false;
    for(auto& v:c.values) v=0; c.values[module]=cap(module,false);
    StudioDSP effect; double difference=0;
    for(int block=0;block<200;block++) {
      effect.begin();
      for(int frame=0;frame<256;frame++) {
        int i=block*256+frame;
        float dryL=.35f*std::sin(i*.019f)+.2f*std::sin(i*.67f);
        float dryR=.3f*std::sin(i*.021f)+.18f*std::sin(i*.53f);
        l=dryL;r=dryR; effect.frame(l,r);
        difference+=(l-dryL)*(l-dryL)+(r-dryR)*(r-dryR);
      }
      effect.end();
    }
    assert(difference>1e-10);
  }
  std::cout << "Studio DSP: finite output, fixed ceiling, clean bypass and audible processing passed\n";
}
