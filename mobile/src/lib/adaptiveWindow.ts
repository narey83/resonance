import { useEffect, useState } from 'react';
import { DeviceEventEmitter, NativeModules, Platform, useWindowDimensions } from 'react-native';

export interface WindowFold { x: number; y: number; width: number; height: number; vertical: boolean }
// WindowManager reports separating folds and occluding hinges, rather than guessing
// from a phone model or hinge angle. Regular phones/iOS simply use window resizing.
export function useWindowFold() {
  const { width, height } = useWindowDimensions();
  const [fold, setFold] = useState<WindowFold | null>(null);
  useEffect(() => {
    const native = Platform.OS === 'android' ? NativeModules.AdaptiveWindow : null;
    if (!native) return;
    const update = (value: WindowFold | null) => setFold(value && typeof value.vertical === 'boolean' ? value : null);
    const subscription = DeviceEventEmitter.addListener('resonanceWindowLayout', update);
    native.watch().then(update).catch(() => update(null));
    return () => subscription.remove();
  }, []);
  return usableFold(fold, width, height);
}

// Ignore stale geometry during rotation and unusably small/invalid pane reports.
export function usableFold(fold: WindowFold | null, width: number, height: number): WindowFold | null {
  if (!fold || ![fold.x, fold.y, fold.width, fold.height].every(Number.isFinite)
    || fold.x < 0 || fold.y < 0 || fold.width < 0 || fold.height < 0
    || fold.x + fold.width > width + 1 || fold.y + fold.height > height + 1
    || (fold.vertical ? fold.x < 240 || width - fold.x - fold.width < 240 : fold.y < 160 || height - fold.y - fold.height < 160)) return null;
  return fold;
}

// A separating crease can guide the full player's two-pane arrangement without
// shrinking ordinary navigation. Only an actual gap hides browsing content.
export function occludingFold(fold: WindowFold | null): WindowFold | null {
  return fold && (fold.vertical ? fold.width > 0 : fold.height > 0) ? fold : null;
}
