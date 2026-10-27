// SPDX-License-Identifier: AGPL-3.0-only
#import <CarPlay/CarPlay.h>
#import <MediaPlayer/MediaPlayer.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@class ResonanceCarPlaySceneDelegate;
static NSDictionary<NSString *, NSArray<NSDictionary *> *> *browseTree;
static __weak ResonanceCarPlaySceneDelegate *carScene;

@interface ResonanceCarPlay : RCTEventEmitter <RCTBridgeModule>
@property(nonatomic) BOOL observing;
+ (instancetype)shared;
- (void)emit:(NSString *)name body:(NSDictionary *)body;
@end
@interface ResonanceCarPlaySceneDelegate : UIResponder <CPTemplateApplicationSceneDelegate>
@property(nonatomic,strong) CPInterfaceController *controller;
@property(nonatomic,strong) CPListTemplate *browser;
@property(nonatomic,strong) NSMutableArray<NSDictionary *> *path;
@property(nonatomic,strong) NSMutableDictionary<NSString *, void (^)(NSString *)> *pending;
@property(nonatomic) NSUInteger page;
- (void)render;
- (void)failedBrowse:(NSString *)mediaId;
@end

@implementation ResonanceCarPlay
RCT_EXPORT_MODULE(ResonanceCarPlay)
static __weak ResonanceCarPlay *module;
+ (BOOL)requiresMainQueueSetup { return YES; }
+ (instancetype)shared { return module; }
- (instancetype)init { if ((self = [super init])) module = self; return self; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"carplay-connect", @"carplay-action"]; }
- (void)startObserving { self.observing = YES; if (carScene) [self emit:@"carplay-connect" body:@{}]; }
- (void)stopObserving { self.observing = NO; }
- (void)emit:(NSString *)name body:(NSDictionary *)body { if (self.observing) [self sendEventWithName:name body:body]; }
RCT_REMAP_METHOD(ready, readyWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve(@(carScene != nil)); }
RCT_REMAP_METHOD(setBrowseTree, setBrowseTree:(NSDictionary *)tree resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  browseTree = [tree copy];
  // A login change clears stale server items and resets navigation before rebuilding.
  if (!browseTree[@"/"]) { carScene.path = [NSMutableArray arrayWithObject:@{@"mediaId":@"/", @"title":@"Resonance"}]; carScene.page = 0; carScene.browser = nil; }
  [carScene render]; resolve(nil);
}
RCT_REMAP_METHOD(browseFailed, browseFailed:(NSString *)mediaId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [carScene failedBrowse:mediaId]; resolve(nil);
}
RCT_EXPORT_METHOD(finish:(NSString *)requestId error:(NSString *)error) {
  void (^completion)(NSString *) = carScene.pending[requestId];
  [carScene.pending removeObjectForKey:requestId];
  if (completion) completion(error);
}
@end

@implementation ResonanceCarPlaySceneDelegate
- (void)templateApplicationScene:(CPTemplateApplicationScene *)scene didConnectInterfaceController:(CPInterfaceController *)controller {
  self.controller = controller; carScene = self;
  self.path = [NSMutableArray arrayWithObject:@{@"mediaId":@"/", @"title":@"Resonance"}];
  self.pending = [NSMutableDictionary dictionary];
  [self render];
  // A dedicated empty React surface starts the shared JS runtime on a car-only launch,
  // without mounting another phone UI/PlayerProvider when the handset later opens.
  id delegate = UIApplication.sharedApplication.delegate;
  if ([delegate respondsToSelector:NSSelectorFromString(@"startCarPlayRuntime")]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [delegate performSelector:NSSelectorFromString(@"startCarPlayRuntime")];
#pragma clang diagnostic pop
  }
  [[ResonanceCarPlay shared] emit:@"carplay-connect" body:@{}];
}
- (void)templateApplicationScene:(CPTemplateApplicationScene *)scene didDisconnectInterfaceController:(CPInterfaceController *)controller {
  self.controller = nil;
  for (void (^completion)(NSString *) in self.pending.allValues) completion(@"CarPlay disconnected");
  [self.pending removeAllObjects]; self.controller = nil; self.browser = nil;
  if (carScene == self) carScene = nil;
}
- (void)request:(NSString *)kind mediaId:(NSString *)mediaId completion:(void (^)(NSString *))completion {
  NSString *requestId = NSUUID.UUID.UUIDString;
  self.pending[requestId] = [completion copy];
  [[ResonanceCarPlay shared] emit:@"carplay-action" body:@{@"kind":kind, @"mediaId":mediaId, @"requestId":requestId}];
  __weak ResonanceCarPlaySceneDelegate *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    void (^pending)(NSString *) = weakSelf.pending[requestId];
    [weakSelf.pending removeObjectForKey:requestId];
    if (pending) pending(@"Open Resonance on your iPhone to check your connection, then retry.");
  });
}
- (void)showError:(NSString *)message {
  CPAlertAction *dismiss = [[CPAlertAction alloc] initWithTitle:@"OK" style:CPAlertActionStyleDefault handler:^(CPAlertAction *action) { [self.controller dismissTemplateAnimated:YES completion:nil]; }];
  [self.controller presentTemplate:[[CPAlertTemplate alloc] initWithTitleVariants:@[@"Unable to load music", message] actions:@[dismiss]] animated:YES completion:nil];
}
- (void)failedBrowse:(NSString *)mediaId {
  if ([self.path.lastObject[@"mediaId"] isEqual:mediaId]) {
    CPListItem *retry = [[CPListItem alloc] initWithText:@"Retry" detailText:@"Check the connection on your iPhone"];
    __weak ResonanceCarPlaySceneDelegate *weakSelf = self;
    retry.handler = ^(id<CPSelectableListItem> item, dispatch_block_t done) {
      [weakSelf request:@"browse" mediaId:mediaId completion:^(NSString *error) { done(); if (error) [weakSelf showError:error]; else [weakSelf render]; }];
    };
    [self.browser updateSections:@[[[CPListSection alloc] initWithItems:@[retry]]]];
  }
}
- (void)render {
  if (!self.controller) return;
  NSString *node = self.path.lastObject[@"mediaId"] ?: @"/";
  NSString *title = self.path.lastObject[@"title"] ?: @"Resonance";
  NSArray *source = browseTree[node];
  NSMutableArray<CPListItem *> *rows = [NSMutableArray array];
  __weak ResonanceCarPlaySceneDelegate *weakSelf = self;
  NSUInteger limit = MIN((NSUInteger)100, CPListTemplate.maximumItemCount - 2);
  NSUInteger offset = self.page * limit;
  if (offset >= source.count && self.page > 0) { self.page = 0; offset = 0; }
  for (NSUInteger i = offset; i < MIN(source.count, offset + limit); i++) {
    NSDictionary *entry = source[i];
    BOOL playable = [entry[@"playable"] isEqual:@"0"] || [entry[@"playable"] isEqual:@"playable"];
    CPListItem *row = [[CPListItem alloc] initWithText:entry[@"title"] ?: @"Unknown track" detailText:entry[@"subtitle"] image:[UIImage systemImageNamed:playable ? @"music.note" : @"folder"]];
    row.accessoryType = playable ? CPListItemAccessoryTypeNone : CPListItemAccessoryTypeDisclosureIndicator;
    row.handler = ^(id<CPSelectableListItem> item, dispatch_block_t done) {
      if (playable) {
        [weakSelf request:@"play" mediaId:entry[@"mediaId"] completion:^(NSString *error) {
          done();
          if (error) [weakSelf showError:error];
          else [weakSelf.controller pushTemplate:CPNowPlayingTemplate.sharedTemplate animated:YES completion:nil];
        }];
      } else {
        [weakSelf.path addObject:@{@"mediaId":entry[@"mediaId"], @"title":entry[@"title"] ?: @"Music"}];
        weakSelf.page = 0; weakSelf.browser = nil; [weakSelf render];
        [weakSelf request:@"browse" mediaId:entry[@"mediaId"] completion:^(NSString *error) { done(); if (error) [weakSelf failedBrowse:entry[@"mediaId"]]; else [weakSelf render]; }];
      }
    };
    [rows addObject:row];
  }
  if (self.page > 0) {
    CPListItem *previous = [[CPListItem alloc] initWithText:@"Previous page" detailText:nil];
    previous.handler = ^(id<CPSelectableListItem> item, dispatch_block_t done) { weakSelf.page--; [weakSelf render]; done(); };
    [rows insertObject:previous atIndex:0];
  }
  if (offset + limit < source.count) {
    CPListItem *next = [[CPListItem alloc] initWithText:@"Next page" detailText:[NSString stringWithFormat:@"%lu items", (unsigned long)source.count]];
    next.handler = ^(id<CPSelectableListItem> item, dispatch_block_t done) { weakSelf.page++; [weakSelf render]; done(); };
    [rows addObject:next];
  }
  if (!rows.count) {
    CPListItem *empty = [[CPListItem alloc] initWithText:source ? @"No music here" : @"Loading music…" detailText:source ? @"Add music or connect to your server on iPhone" : @"Preparing your library"];
    empty.enabled = NO; [rows addObject:empty];
  }
  NSArray *sections = @[[[CPListSection alloc] initWithItems:rows]];
  if (self.browser) { [self.browser updateSections:sections]; return; }
  self.browser = [[CPListTemplate alloc] initWithTitle:title sections:sections];
  if (self.path.count > 1) {
    self.browser.leadingNavigationBarButtons = @[[[CPBarButton alloc] initWithTitle:@"Back" handler:^(CPBarButton *button) {
      [weakSelf.path removeLastObject]; weakSelf.page = 0; weakSelf.browser = nil; [weakSelf render];
    }]];
  }
  self.browser.trailingNavigationBarButtons = @[
  [[CPBarButton alloc] initWithTitle:@"Refresh" handler:^(CPBarButton *button) {
    [weakSelf request:@"refresh" mediaId:@"/" completion:^(NSString *error) { if (error) [weakSelf showError:error]; }];
  }], [[CPBarButton alloc] initWithTitle:@"Now Playing" handler:^(CPBarButton *button) {
    [weakSelf.controller pushTemplate:CPNowPlayingTemplate.sharedTemplate animated:YES completion:nil];
  }]];
  // Keep native template depth bounded while our logical path supports arbitrarily
  // nested music folders. Next/previous pages update the same template in place.
  [self.controller setRootTemplate:self.browser animated:NO completion:nil];
}
@end
