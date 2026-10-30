// SPDX-License-Identifier: AGPL-3.0-only
#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <vector>
#include "StudioTone.h"

namespace resonance {
// Parameters are published at buffer boundaries; no locks, allocation or bridge calls on
// the render thread. The same core runs in Media3 and the AVPlayer processing tap.
enum Parameter { Exciter, Warmth, Punch, Glue, Width, MonoBass, Flutter, Echo, Room, Crush, Filter, Count };
struct Controls {
  std::array<std::atomic<float>, Count> values{};
  std::array<std::atomic<float>, EqCount> eq{};
  std::atomic<float> bassControl{0}, smoothness{0}, amount{1};
  std::atomic<bool> enabled{false}, pushed{false}, bypass{false};
  std::atomic<float> input{0}, output{0}, reduction{0}, correlation{1};
  std::atomic<unsigned> buffers{0};
};
inline Controls& controls() { static Controls c; return c; }
inline float limit(float x, float low, float high) { return std::isfinite(x) ? std::max(low, std::min(high, x)) : low; }
inline float cap(int parameter, bool pushed) {
  static constexpr float normal[Count] = {.35f,.35f,.3f,.4f,.3f,1.f,.15f,.25f,.25f,.15f,.3f};
  return pushed ? 1.f : normal[parameter];
}
class StudioDSP {
  StudioTone tone;
  double rate = 48000;
  float monoLow=0, high[2]{}, filtered[2]{}, fast=0, slow=0, envelope=0, limiter=1, phase=0;
  std::vector<float> delay;
  size_t cursor=0;
  std::array<float, Count> p{}, targetValues{};
  float rackBlend=0;
  bool enabled=false, bypass=false;
  float inPeak=0, outPeak=0, minGain=1;
  double leftEnergy=0, rightEnergy=0, cross=0;
  float lowCoeff=0, highCoeff=0, filterCoeff=0;
  float fastCoeff=0, slowCoeff=0, attackCoeff=0, releaseCoeff=0, limiterRelease=0, rmsCoeff=0, dryPower=0, wetPower=0, compareBlend=0;
public:
  explicit StudioDSP(double sampleRate=48000) : delay(384004, 0) { prepare(sampleRate); }
  void prepare(double sampleRate) {
    rate=limit(static_cast<float>(sampleRate),8000,192000);
    std::fill(delay.begin(),delay.end(),0); cursor=0;
    for(int c=0;c<2;c++) high[c]=filtered[c]=0;
    monoLow=0;
    fast=slow=envelope=phase=0; limiter=1;
    lowCoeff=1-std::exp(-2*3.141592653589793*140/rate);
    highCoeff=1-std::exp(-2*3.141592653589793*3500/rate);
    fastCoeff=1-std::exp(-1/(.002*rate)); slowCoeff=1-std::exp(-1/(.060*rate));
    attackCoeff=1-std::exp(-1/(.01*rate)); releaseCoeff=1-std::exp(-1/(.15*rate));
    limiterRelease=1-std::exp(-1/(.1*rate)); rmsCoeff=1-std::exp(-1/(.4*rate));
    dryPower=wetPower=compareBlend=0;
    tone.prepare(rate);
  }
  void begin() {
    auto& c=controls(); enabled=c.enabled.load(); bypass=c.bypass.load();
    bool pushed=c.pushed.load();
    float amount=limit(c.amount.load(),0,1);
    std::array<float,EqCount> eq;
    for(int i=0;i<EqCount;i++) eq[i]=toneLimit(c.eq[i].load(),-6,6)*amount;
    tone.configure(eq,limit(c.bassControl.load(),0,1)*amount,limit(c.smoothness.load(),0,1)*amount);
    for(int i=0;i<Count;i++) { targetValues[i]=limit(c.values[i].load(),0,cap(i,pushed))*amount; p[i]=std::min(p[i],cap(i,pushed)); }
    filterCoeff=1-std::exp(-2*3.141592653589793*(18000*std::pow(.025f,p[Filter]))/rate);
    inPeak=outPeak=0; minGain=1; leftEnergy=rightEnergy=cross=0;
  }
  void frame(float& left,float& right) {
    for(int i=0;i<Count;i++) p[i] += attackCoeff*(targetValues[i]-p[i]);
    rackBlend += fastCoeff*((enabled?1.f:0.f)-rackBlend);
    float dry[2]={std::isfinite(left)?limit(left,-16,16):0, std::isfinite(right)?limit(right,-16,16):0};
    float x[2]={dry[0],dry[1]};
    inPeak=std::max(inPeak,std::max(std::abs(x[0]),std::abs(x[1])));
    float level=std::max(std::abs(x[0]),std::abs(x[1]));
    // Envelopes are linked across channels to preserve the stereo image.
    fast += (level-fast)*fastCoeff;
    slow += (level-slow)*slowCoeff;
    envelope += (level-envelope)*(level>envelope?attackCoeff:releaseCoeff);
    if(enabled || rackBlend>.00001f) {
      tone.process(x[0],x[1]);
      float drive=1+p[Warmth]*7;
      float transient=limit(1+p[Punch]*3*(fast-slow)/std::max(.1f,slow),.5f,2.5f);
      float compression=std::pow(std::max(1.f,envelope/.25f),-.65f*p[Glue]);
      for(int c=0;c<2;c++) {
        high[c] += highCoeff*(x[c]-high[c]);
        float treble=x[c]-high[c];
        float harmonic=std::tanh(treble*4)-treble*4;
        x[c] += harmonic*p[Exciter]*.65f;
        float saturated=std::tanh(x[c]*drive)/std::sqrt(drive);
        x[c] += (saturated-x[c])*p[Warmth];
        x[c] *= transient*compression;
      }
      float mid=(x[0]+x[1])*.5f;
      float side=(x[0]-x[1])*.5f;
      side*=1+p[Width];
      x[0]=mid+side; x[1]=mid-side;
      // Conservative analytical headroom for boosts; no compressor makeup gain.
      float compensation=1/std::sqrt(1+p[Exciter]*1.5f+p[Warmth]*3+p[Punch]+p[Width]);
      phase += 2*3.141592653589793f*.7f/rate;
      if(phase>2*3.141592653589793f) phase-=2*3.141592653589793f;
      float flutterDelay=(.003f+.002f*std::sin(phase))*rate;
      for(int c=0;c<2;c++) {
        auto read=[&](float frames) {
          float pos=static_cast<float>(cursor)/2-frames;
          const int length=static_cast<int>(delay.size()/2);
          while(pos<0) pos+=length;
          int i=static_cast<int>(pos)%length; float fraction=pos-std::floor(pos);
          return delay[i*2+c]*(1-fraction)+delay[((i+1)%length)*2+c]*fraction;
        };
        float delayed=read(.28f*rate);
        float room=read((c==0?.031f:.043f)*rate);
        float flutter=read(flutterDelay);
        delay[cursor+c]=limit(x[c]+delayed*p[Echo]*.45f,-4,4);
        x[c] += (flutter-x[c])*p[Flutter];
        x[c] = (x[c]+delayed*p[Echo]+room*p[Room]*.5f)/(1+p[Echo]+p[Room]*.5f);
        if(p[Crush]>.001f) {
          float steps=std::pow(2.f,16-12*p[Crush]);
          x[c] += (std::round(x[c]*steps)/steps-x[c])*p[Crush];
        }
        filtered[c] += filterCoeff*(x[c]-filtered[c]);
        x[c] += (filtered[c]-x[c])*p[Filter];
        x[c] *= compensation;
      }
      // Centre bass after the creative effects so echo/room cannot re-widen it.
      monoLow += lowCoeff*((x[0]-x[1])*.5f-monoLow);
      x[0] -= monoLow*p[MonoBass]; x[1] += monoLow*p[MonoBass];
      cursor=(cursor+2)%delay.size();
    }
    for(int c=0;c<2;c++) x[c]=dry[c]+(x[c]-dry[c])*rackBlend;
    // Attenuate dry A/B to the wet RMS reference; never boost a quiet signal.
    // Keep the wet path running during comparison so envelopes and echo tails stay live.
    dryPower += rmsCoeff*((dry[0]*dry[0]+dry[1]*dry[1])*.5f-dryPower);
    wetPower += rmsCoeff*((x[0]*x[0]+x[1]*x[1])*.5f-wetPower);
    float comparison=std::min(1.f,std::sqrt(wetPower/std::max(1e-12f,dryPower)));
    float wetMatch=std::min(1.f,std::sqrt(dryPower/std::max(1e-12f,wetPower)));
    if(enabled) for(int c=0;c<2;c++) x[c] *= wetMatch;
    compareBlend += fastCoeff*((enabled && bypass?1.f:0.f)-compareBlend);
    for(int c=0;c<2;c++) x[c] += (dry[c]*comparison-x[c])*compareBlend;
    // Peak ceiling applies to dry bypass too. Instant linked attack and gentle release.
    // This is a sample-peak limiter, not a claimed true-peak or hearing-safety system.
    constexpr float ceiling=.891250938f; // -1 dBFS
    float peak=std::max(std::abs(x[0]),std::abs(x[1]));
    float target=peak>ceiling?ceiling/peak:1;
    limiter=target<limiter?target:limiter+(target-limiter)*limiterRelease;
    for(int c=0;c<2;c++) x[c]=limit(x[c]*limiter,-ceiling,ceiling);
    minGain=std::min(minGain,limiter);
    outPeak=std::max(outPeak,std::max(std::abs(x[0]),std::abs(x[1])));
    leftEnergy+=x[0]*x[0]; rightEnergy+=x[1]*x[1]; cross+=x[0]*x[1];
    left=x[0]; right=x[1];
  }
  void end() {
    auto& c=controls(); c.input.store(inPeak); c.output.store(outPeak);
    c.reduction.store(-20*std::log10(std::max(.00001f,minGain)));
    c.correlation.store(leftEnergy*rightEnergy>1e-14?limit(cross/std::sqrt(leftEnergy*rightEnergy),-1,1):1);
    c.buffers.fetch_add(1);
  }
};
}
