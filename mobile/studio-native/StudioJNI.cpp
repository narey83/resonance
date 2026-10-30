#include <jni.h>
#include <cstdint>
#include "StudioDSP.h"
using namespace resonance;
extern "C" {
JNIEXPORT jlong JNICALL Java_com_doublesymmetry_trackplayer_studio_StudioNative_create(JNIEnv*,jobject) { return reinterpret_cast<jlong>(new StudioDSP()); }
JNIEXPORT void JNICALL Java_com_doublesymmetry_trackplayer_studio_StudioNative_destroy(JNIEnv*,jobject,jlong handle) { delete reinterpret_cast<StudioDSP*>(handle); }
JNIEXPORT void JNICALL Java_com_doublesymmetry_trackplayer_studio_StudioNative_prepare(JNIEnv*,jobject,jlong handle,jint rate) { if(handle) reinterpret_cast<StudioDSP*>(handle)->prepare(rate); }
JNIEXPORT void JNICALL Java_com_doublesymmetry_trackplayer_studio_StudioNative_configure(JNIEnv* env,jobject,jfloatArray array,jboolean enabled,jboolean pushed,jboolean bypass,jfloatArray eqArray,jfloat bassControl,jfloat smoothness,jfloat amount) {
  if(env->GetArrayLength(array)!=Count || env->GetArrayLength(eqArray)!=EqCount) return;
  float values[Count],eq[EqCount]; env->GetFloatArrayRegion(array,0,Count,values);
  env->GetFloatArrayRegion(eqArray,0,EqCount,eq);
  auto& c=controls(); c.pushed.store(pushed); c.enabled.store(enabled); c.bypass.store(bypass);
  for(int i=0;i<Count;i++) c.values[i].store(limit(values[i],0,cap(i,pushed)));
  for(int i=0;i<EqCount;i++) c.eq[i].store(toneLimit(eq[i],-6,6));
  c.bassControl.store(limit(bassControl,0,1));c.smoothness.store(limit(smoothness,0,1));c.amount.store(limit(amount,0,1));
}
JNIEXPORT jfloatArray JNICALL Java_com_doublesymmetry_trackplayer_studio_StudioNative_meters(JNIEnv* env,jobject) {
  auto& c=controls(); float values[]={c.input.load(),c.output.load(),c.reduction.load(),c.correlation.load(),static_cast<float>(c.buffers.load())};
  auto result=env->NewFloatArray(5); env->SetFloatArrayRegion(result,0,5,values); return result;
}
JNIEXPORT void JNICALL Java_com_doublesymmetry_trackplayer_studio_StudioNative_process(JNIEnv* env,jobject,jlong handle,jobject input,jint offset,jobject output,jint bytes,jint channels) {
  auto* dsp=reinterpret_cast<StudioDSP*>(handle);
  auto* source=reinterpret_cast<int16_t*>(static_cast<char*>(env->GetDirectBufferAddress(input))+offset);
  auto* target=static_cast<int16_t*>(env->GetDirectBufferAddress(output));
  if(!dsp||!source||!target||channels<1) return;
  dsp->begin();
  for(int frame=0;frame<bytes/(channels*2);frame++) {
    int base=frame*channels;
    float left=source[base]/32768.f, right=channels>1?source[base+1]/32768.f:left;
    dsp->frame(left,right); target[base]=static_cast<int16_t>(left*32767);
    if(channels>1) target[base+1]=static_cast<int16_t>(right*32767);
    for(int c=2;c<channels;c++) target[base+c]=static_cast<int16_t>(limit(source[base+c]/32768.f,-.8912509f,.8912509f)*32767);
  }
  dsp->end();
}
}
