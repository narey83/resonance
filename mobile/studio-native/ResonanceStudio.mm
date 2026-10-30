// SPDX-License-Identifier: AGPL-3.0-only
#import <AVFoundation/AVFoundation.h>
#import <MediaToolbox/MediaToolbox.h>
#import <React/RCTBridgeModule.h>
#import <objc/runtime.h>
#include "StudioDSP.h"

struct TapState {
  resonance::StudioDSP dsp;
  bool floating=false, planar=false;
};
static void TapInit(MTAudioProcessingTapRef tap, void *client, void **storage) { *storage=client; }
static void TapFinalize(MTAudioProcessingTapRef tap) { delete static_cast<TapState*>(MTAudioProcessingTapGetStorage(tap)); }
static void TapPrepare(MTAudioProcessingTapRef tap, CMItemCount frames, const AudioStreamBasicDescription *format) {
  auto* state=static_cast<TapState*>(MTAudioProcessingTapGetStorage(tap));
  state->floating=format->mFormatID==kAudioFormatLinearPCM && (format->mFormatFlags&kAudioFormatFlagIsFloat) && format->mBitsPerChannel==32;
  state->planar=(format->mFormatFlags&kAudioFormatFlagIsNonInterleaved)!=0;
  state->dsp.prepare(format->mSampleRate);
}
static void TapUnprepare(MTAudioProcessingTapRef tap) {}
static void TapProcess(MTAudioProcessingTapRef tap, CMItemCount requested, MTAudioProcessingTapFlags flags, AudioBufferList *buffers, CMItemCount *frames, MTAudioProcessingTapFlags *outFlags) {
  if(MTAudioProcessingTapGetSourceAudio(tap,requested,buffers,outFlags,nullptr,frames)!=noErr) { *frames=0; return; }
  auto* state=static_cast<TapState*>(MTAudioProcessingTapGetStorage(tap));
  if(!state->floating || buffers->mNumberBuffers==0) return;
  auto& dsp=state->dsp; dsp.begin();
  for(CMItemCount frame=0;frame<*frames;frame++) {
    auto& first=buffers->mBuffers[0];
    if(!first.mData) continue;
    auto* a=static_cast<float*>(first.mData);
    float* left=&a[frame*first.mNumberChannels];
    float* right=left;
    if(state->planar && buffers->mNumberBuffers>1 && buffers->mBuffers[1].mData) right=&static_cast<float*>(buffers->mBuffers[1].mData)[frame];
    else if(first.mNumberChannels>1) right=left+1;
    float l=*left,r=*right; dsp.frame(l,r); *left=l; *right=r;
    // Additional surround channels get the same fixed peak ceiling.
    if(!state->planar) for(UInt32 c=2;c<first.mNumberChannels;c++) a[frame*first.mNumberChannels+c]=resonance::limit(a[frame*first.mNumberChannels+c],-.8912509f,.8912509f);
    else for(UInt32 c=2;c<buffers->mNumberBuffers;c++) if(buffers->mBuffers[c].mData) {
      auto* data=static_cast<float*>(buffers->mBuffers[c].mData); data[frame]=resonance::limit(data[frame],-.8912509f,.8912509f);
    }
  }
  dsp.end();
}
static void AttachStudio(AVPlayerItem *item) {
  if(!item || item.audioMix) return;
  // withStudio preloads asset tracks in SwiftAudioEx's existing asynchronous load.
  // Installation here is synchronous, preserving AVPlayer replacement/seek semantics.
  NSArray<AVAssetTrack *> *tracks=[item.asset tracksWithMediaType:AVMediaTypeAudio];
  NSMutableArray *parameters=[NSMutableArray array];
  for(AVAssetTrack *track in tracks) {
    auto* state=new TapState();
    MTAudioProcessingTapCallbacks callbacks={kMTAudioProcessingTapCallbacksVersion_0,state,TapInit,TapFinalize,TapPrepare,TapUnprepare,TapProcess};
    MTAudioProcessingTapRef tap=nullptr;
    OSStatus result=MTAudioProcessingTapCreate(kCFAllocatorDefault,&callbacks,kMTAudioProcessingTapCreationFlag_PostEffects,&tap);
    if(result!=noErr) { delete state; continue; }
    AVMutableAudioMixInputParameters *input=[AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:track];
    input.audioTapProcessor=tap; CFRelease(tap); [parameters addObject:input];
  }
  if(parameters.count) { AVMutableAudioMix *mix=[AVMutableAudioMix audioMix]; mix.inputParameters=parameters; item.audioMix=mix; }
}
// SwiftAudioEx replaces AVPlayer items for local files and progressive server audio.
// Intercept that public boundary without depending on the pod's private wrapper fields.
@interface AVPlayer (ResonanceStudio)
@end
@implementation AVPlayer (ResonanceStudio)
+ (void)load {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    method_exchangeImplementations(class_getInstanceMethod(self,@selector(replaceCurrentItemWithPlayerItem:)),class_getInstanceMethod(self,@selector(resonance_replaceCurrentItem:)));
  });
}
- (void)resonance_replaceCurrentItem:(AVPlayerItem *)item {
  AttachStudio(item);
  [self resonance_replaceCurrentItem:item];
}
@end

@interface ResonanceStudio : NSObject <RCTBridgeModule>
@end
@implementation ResonanceStudio
RCT_EXPORT_MODULE(ResonanceStudio)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (NSDictionary *)constantsToExport { return @{@"version": @2}; }
RCT_EXPORT_METHOD(configure:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSArray *values=options[@"values"];
  if(![values isKindOfClass:[NSArray class]] || values.count!=resonance::Count) { reject(@"studio_config",@"Invalid Studio parameters",nil); return; }
  NSArray *eq=options[@"eq"];
  if(eq && (![eq isKindOfClass:[NSArray class]] || eq.count!=resonance::EqCount)) { reject(@"studio_config",@"Invalid EQ parameters",nil); return; }
  for(id value in values) if(![value isKindOfClass:[NSNumber class]]) { reject(@"studio_config",@"Invalid Studio value",nil); return; }
  for(id value in eq) if(![value isKindOfClass:[NSNumber class]]) { reject(@"studio_config",@"Invalid EQ value",nil); return; }
  for(NSString *key in @[@"bassControl",@"smoothness",@"amount"]) {
    id value=options[key];
    if(value && ![value isKindOfClass:[NSNumber class]]) { reject(@"studio_config",@"Invalid tone value",nil); return; }
  }
  auto& c=resonance::controls(); bool pushed=[options[@"pushed"] boolValue];
  c.pushed.store(pushed); c.enabled.store([options[@"enabled"] boolValue]); c.bypass.store([options[@"bypass"] boolValue]);
  for(int i=0;i<resonance::Count;i++) c.values[i].store(resonance::limit([values[i] floatValue],0,resonance::cap(i,pushed)));
  for(int i=0;i<resonance::EqCount;i++) c.eq[i].store(resonance::toneLimit(eq ? [eq[i] floatValue] : 0,-6,6));
  c.bassControl.store(resonance::limit([options[@"bassControl"] floatValue],0,1));
  c.smoothness.store(resonance::limit([options[@"smoothness"] floatValue],0,1));
  c.amount.store(options[@"amount"] ? resonance::limit([options[@"amount"] floatValue],0,1) : 1);
  resolve(nil);
}
RCT_EXPORT_METHOD(meters:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  auto& c=resonance::controls();
  resolve(@{@"input":@(c.input.load()),@"output":@(c.output.load()),@"reduction":@(c.reduction.load()),@"correlation":@(c.correlation.load()),@"buffers":@(c.buffers.load())});
}
@end
