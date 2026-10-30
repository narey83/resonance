#include "../studio-native/StudioDSP.h"
#include <cassert>
#include <chrono>
#include <iostream>
#include <limits>
using namespace resonance;
static double response(int rate,double frequency,const std::array<float,EqCount>& eq,float bass=0,float smooth=0) {
  StudioTone tone;tone.prepare(rate);tone.configure(eq,bass,smooth);
  double energy=0;
  for(int i=0;i<rate*2;i++) {
    float l=.2f*std::sin(2*3.141592653589793*frequency*i/rate),r=l;
    tone.process(l,r);assert(std::isfinite(l) && l==r);
    if(i>=rate) energy+=l*l;
  }
  return energy/rate;
}
static void verifyTone(int rate) {
  std::array<float,EqCount> eq{};
  StudioTone neutral;neutral.prepare(rate);neutral.configure(eq,0,0);
  for(int i=0;i<1000;i++) { float l=i*.0001f,r=-l,expected=l;neutral.process(l,r);assert(l==expected && r==-expected); }
  if(rate>=44100) {
    const double low=response(rate,30,eq),mid=response(rate,500,eq),high=response(rate,rate*.4,eq);
    eq[0]=6;
    assert(response(rate,30,eq)/low > 1.6*response(rate,3000,eq)/response(rate,3000,{}));
    eq.fill(0);eq[7]=6;
    assert(response(rate,rate*.4,eq)/high > 2.5*response(rate,500,eq)/mid);
    eq.fill(0);eq[5]=6;
    assert(response(rate,2500,eq)/response(rate,2500,{}) > 2.5*response(rate,60,eq)/response(rate,60,{}));
    eq.fill(0);eq[6]=-6;
    assert(response(rate,6000,eq)/response(rate,6000,{}) < .35);
    eq.fill(0);
    assert(response(rate,160,eq,1)/response(rate,160,eq) < .89);
    assert(response(rate,4500,eq,0,1)/response(rate,4500,eq) < .75);
    assert(response(rate,1000,eq,1)/response(rate,1000,eq) > .98);
    assert(response(rate,160,eq,0,1)/response(rate,160,eq) > .98);
  }
  StudioTone changing;changing.prepare(rate);
  for(int block=0;block<500;block++) {
    for(int i=0;i<EqCount;i++) eq[i]=(block+i)%2 ? 6 : -6;
    if(block==1)eq[0]=std::numeric_limits<float>::quiet_NaN();
    changing.configure(eq,block%2,1);
    for(int i=0;i<256;i++) { float l=.2f*std::sin((block*256+i)*.1f),r=-l;changing.process(l,r);assert(std::isfinite(l) && std::abs(l)<10 && std::abs(l+r)<1e-6); }
  }
  changing.configure({},0,0);
  float l=0,r=0;
  for(int i=0;i<rate*2;i++) { l=r=0;changing.process(l,r);assert(std::isfinite(l)&&std::isfinite(r)); }
  assert(std::abs(l)<1e-6 && std::abs(r)<1e-6);
}
static void verifyEngine(int rate) {
  auto& c=controls();c.enabled=true;c.pushed=false;c.bypass=false;c.amount=.65f;c.bassControl=.35f;c.smoothness=.25f;
  for(auto& v:c.values)v=0;
  c.values[Warmth]=.06f;c.values[Punch]=.04f;
  const float gains[EqCount]={2.2f,.7f,-.7f,-.4f,0,.5f,-.4f,.7f};
  for(int i=0;i<EqCount;i++)c.eq[i]=gains[i];
  StudioDSP reference(rate),comparison(rate);
  double aEnergy=0,bEnergy=0,shapeError=0,returnError=0;
  for(int block=0;block<rate*8/256;block++) {
    const double t0=block*256.0/rate;
    c.bypass=false;reference.begin();c.bypass=t0>=2 && t0<6;comparison.begin();
    for(int i=0;i<256;i++) {
      const double t=(block*256+i)/double(rate);
      float l=.12f*std::sin(2*3.141592653589793*160*t)+.06f*std::sin(2*3.141592653589793*4500*t);
      float r=.11f*std::sin(2*3.141592653589793*220*t)+.05f*std::sin(2*3.141592653589793*6000*t);
      float bL=l,bR=r,aL=l,aR=r;reference.frame(bL,bR);comparison.frame(aL,aR);
      if(t>4.5&&t<5.9) {aEnergy+=aL*aL+aR*aR;bEnergy+=bL*bL+bR*bR;shapeError=std::max(shapeError,double(std::abs(aL*r-aR*l)));}
      if(t>6.1) returnError=std::max(returnError,double(std::max(std::abs(aL-bL),std::abs(aR-bR))));
    }
    reference.end();comparison.end();
  }
  assert(aEnergy>0&&bEnergy>0);assert(std::abs(10*std::log10(aEnergy/bEnergy))<.2);
  assert(shapeError<2e-6&&returnError<1e-6);
  // Amount can be brought to zero during live processing without retaining EQ.
  c.amount=0;c.bypass=false;
  float settledL=0,settledR=0;
  for(int block=0;block<rate/256;block++) {reference.begin();for(int i=0;i<256;i++){settledL=.1f;settledR=-.08f;reference.frame(settledL,settledR);}reference.end();}
  assert(std::abs(settledL-.1f)<1e-5&&std::abs(settledR+.08f)<1e-5);
  // Amount zero neutralises both the old rack and new tone stages.
  c.amount=0;c.bypass=false;StudioDSP zero(rate);
  for(int block=0;block<100;block++) {zero.begin();for(int i=0;i<256;i++){float l=.1f,r=-.08f;zero.frame(l,r);assert(std::abs(l-.1f)<1e-6&&std::abs(r+.08f)<1e-6);}zero.end();}
  // Positive EQ, strong dynamics and rapidly changing controls retain the final ceiling.
  c.amount=1;StudioDSP peaks(rate);
  for(int block=0;block<100;block++) {
    for(int i=0;i<EqCount;i++)c.eq[i]=block%2?6:-6;
    c.bypass=block%3==0;peaks.begin();
    for(int i=0;i<256;i++){float l=4*std::sin(i*.13f),r=-l;peaks.frame(l,r);assert(std::isfinite(l)&&std::isfinite(r)&&std::abs(l)<=.891251f&&std::abs(r)<=.891251f);}peaks.end();
  }
  std::cout<<"Tone + A/B passed at "<<rate<<" Hz; level difference "<<10*std::log10(aEnergy/bEnergy)<<" dB\n";
}
int main() {
  for(int rate:{8000,44100,48000,96000,192000})verifyTone(rate);
  for(int rate:{44100,48000,96000,192000})verifyEngine(rate);
}
