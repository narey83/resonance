// SPDX-License-Identifier: AGPL-3.0-only
#pragma once
#include <algorithm>
#include <array>
#include <cmath>

namespace resonance {
constexpr int EqCount=8;
constexpr std::array<double,EqCount> EqFrequencies{60,120,250,500,1000,2500,6000,12000};
inline float toneLimit(float value,float low,float high) {
  return std::isfinite(value)?std::max(low,std::min(high,value)):0;
}
// RBJ biquads, following https://www.w3.org/TR/audio-eq-cookbook/.
// Double-precision direct form I keeps filter history meaningful while gains slew.
struct ToneBiquad {
  double b0=1,b1=0,b2=0,a1=0,a2=0;
  double x1[2]{},x2[2]{},y1[2]{},y2[2]{};
  void reset() { for(int c=0;c<2;c++) x1[c]=x2[c]=y1[c]=y2[c]=0; }
  void coefficients(double B0,double B1,double B2,double A0,double A1,double A2) {
    b0=B0/A0;b1=B1/A0;b2=B2/A0;a1=A1/A0;a2=A2/A0;
  }
  float process(float x,int channel) {
    double y=b0*x+b1*x1[channel]+b2*x2[channel]-a1*y1[channel]-a2*y2[channel];
    if(!std::isfinite(y)) { reset(); return 0; }
    if(std::abs(y)<1e-20) y=0;
    x2[channel]=x1[channel];x1[channel]=x;y2[channel]=y1[channel];y1[channel]=y;
    return static_cast<float>(y);
  }
  void gain(double rate,double hz,double db,int shelf=0) {
    const double angle=2*3.141592653589793*std::min(hz,rate*.45)/rate;
    const double cs=std::cos(angle),sn=std::sin(angle),A=std::pow(10,db/40);
    if(shelf==0) {
      const double alpha=sn/(2*.85);
      coefficients(1+alpha*A,-2*cs,1-alpha*A,1+alpha/A,-2*cs,1-alpha/A);
    } else {
      const double root=std::sqrt(2*A)*sn;
      if(shelf<0) coefficients(A*((A+1)-(A-1)*cs+root),2*A*((A-1)-(A+1)*cs),A*((A+1)-(A-1)*cs-root),
        (A+1)+(A-1)*cs+root,-2*((A-1)+(A+1)*cs),(A+1)+(A-1)*cs-root);
      else coefficients(A*((A+1)+(A-1)*cs+root),-2*A*((A-1)+(A+1)*cs),A*((A+1)+(A-1)*cs-root),
        (A+1)-(A-1)*cs+root,2*((A-1)-(A+1)*cs),(A+1)-(A-1)*cs-root);
    }
  }
  void detector(double rate,double hz,bool bandpass) {
    const double angle=2*3.141592653589793*std::min(hz,rate*.4)/rate;
    const double cs=std::cos(angle),alpha=std::sin(angle)/(2*.707106781186548);
    if(bandpass) coefficients(alpha,0,-alpha,1+alpha,-2*cs,1-alpha);
    else coefficients((1-cs)/2,1-cs,(1-cs)/2,1+alpha,-2*cs,1-alpha);
  }
};
class StudioTone {
  std::array<ToneBiquad,EqCount> eq{};
  ToneBiquad bassFilter,trebleFilter,bassDetector,trebleDetector;
  std::array<float,EqCount> target{},current{};
  double rate=48000;
  float bass=0,smooth=0,fullEnvelope=0,bassEnvelope=0,trebleEnvelope=0;
  float bassReduction=0,trebleReduction=0;
  // Double precision lets the slow headroom fade reach unity even at 192 kHz.
  double preamp=1,preampTarget=1,preampSlew=0;
  float attack=0,release=0,gainSlew=0;
  int countdown=0;
  bool active=false,requested=false;
  static float follow(float value,float previous,float attack,float release) {
    return previous+(value-previous)*(value>previous?attack:release);
  }
  static float reduction(float envelope,float threshold,float amount,float maximum) {
    return amount>0 ? std::min(maximum*amount,std::max(0.f,20*std::log10(std::max(1e-9f,envelope)/threshold))*.6f*amount) : 0;
  }
  void update() {
    bool settled=!requested;
    for(int i=0;i<EqCount;i++) {
      current[i]+=gainSlew*(target[i]-current[i]);
      if(std::abs(current[i])<1e-5f && target[i]==0) current[i]=0;
      settled=settled && current[i]==0;
      eq[i].gain(rate,EqFrequencies[i],current[i],i==0?-1:i==EqCount-1?1:0);
    }
    const float bassTarget=reduction(bassEnvelope,std::max(.025f,fullEnvelope*.65f),bass,4);
    const float trebleTarget=reduction(trebleEnvelope,std::max(.012f,fullEnvelope*.3f),smooth,3);
    bassReduction+=gainSlew*(bassTarget-bassReduction);
    trebleReduction+=gainSlew*(trebleTarget-trebleReduction);
    if(bass==0 && bassReduction<1e-5f) bassReduction=0;
    if(smooth==0 && trebleReduction<1e-5f) trebleReduction=0;
    bassFilter.gain(rate,160,-bassReduction);
    trebleFilter.gain(rate,4500,-trebleReduction);
    if(settled && bassReduction==0 && trebleReduction==0 && std::abs(preamp-1)<1e-5f) {
      active=false; preamp=1;
      for(auto& band:eq) band.reset();
      bassFilter.reset();trebleFilter.reset();
    }
  }
public:
  void prepare(double sampleRate) {
    rate=std::isfinite(sampleRate)?std::max(8000.,std::min(192000.,sampleRate)):48000;
    for(auto& band:eq) band=ToneBiquad{};
    bassFilter=trebleFilter=bassDetector=trebleDetector=ToneBiquad{};
    bassDetector.detector(rate,180,false);trebleDetector.detector(rate,4500,true);
    target.fill(0);current.fill(0);
    bass=smooth=fullEnvelope=bassEnvelope=trebleEnvelope=bassReduction=trebleReduction=0;
    preamp=preampTarget=1;countdown=0;active=requested=false;
    attack=1-std::exp(-1/(.01*rate));release=1-std::exp(-1/(.18*rate));
    gainSlew=1-std::exp(-32/(.02*rate));preampSlew=1-std::exp(-1/(.02*rate));
  }
  StudioTone() { prepare(48000); }
  void configure(const std::array<float,EqCount>& gains,float bassAmount,float smoothAmount) {
    float positive=0;requested=false;
    for(int i=0;i<EqCount;i++) { target[i]=toneLimit(gains[i],-6,6);positive+=std::max(0.f,target[i]);requested=requested || target[i]!=0; }
    // Reserve conservative headroom for positive EQ; gain is never recovered by boosting.
    preampTarget=std::pow(10.,-positive/20.);
    bass=toneLimit(bassAmount,0,1);smooth=toneLimit(smoothAmount,0,1);
    requested=requested || bass>0 || smooth>0;
    if(requested && !active) { active=true;countdown=0; }
  }
  void process(float& left,float& right) {
    if(!active) return;
    preamp+=preampSlew*(preampTarget-preamp);
    if(countdown--<=0) { update();countdown=31; }
    float sample[2]={std::isfinite(left)?static_cast<float>(left*preamp):0,std::isfinite(right)?static_cast<float>(right*preamp):0};
    for(auto& band:eq) for(int c=0;c<2;c++) sample[c]=band.process(sample[c],c);
    float bassPeak=0,treblePeak=0;
    for(int c=0;c<2;c++) {
      bassPeak=std::max(bassPeak,std::abs(bassDetector.process(sample[c],c)));
      treblePeak=std::max(treblePeak,std::abs(trebleDetector.process(sample[c],c)));
    }
    fullEnvelope=follow(std::max(std::abs(sample[0]),std::abs(sample[1])),fullEnvelope,attack,release);
    bassEnvelope=follow(bassPeak,bassEnvelope,attack,release);
    trebleEnvelope=follow(treblePeak,trebleEnvelope,attack,release);
    for(int c=0;c<2;c++) sample[c]=trebleFilter.process(bassFilter.process(sample[c],c),c);
    left=sample[0];right=sample[1];
  }
  std::array<float,2> reductions() const { return {bassReduction,trebleReduction}; }
};
}
