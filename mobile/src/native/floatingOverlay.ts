// <copyright file="floatingOverlay.ts" company="John Narey">
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-only
//   Part of Resonance, a Soulseek client based on slskd.
// </copyright>
//
// Typed JS bridge to the native Android floating-overlay controller
// (SYSTEM_ALERT_WINDOW). No-ops on iOS or before the native module is built in.

import { DeviceEventEmitter, NativeModules, Platform, TurboModuleRegistry } from 'react-native';

export type OverlayAction = 'play' | 'pause' | 'next' | 'prev' | 'open';

// For 'open', the native bubble also sends its on-screen rect (dp) so the JS
// full player can morph out of it.
export interface OverlayActionEvent {
  action: OverlayAction;
  x?:     number;
  y?:     number;
  size?:  number;
}

export interface OverlayState {
  title:      string;
  artist:     string;
  isPlaying:  boolean;
  // Base64-encoded artwork (no data: prefix), or null for the fallback disc.
  artBase64?: string | null;
}

interface FloatingOverlayNative {
  hasPermission(): Promise<boolean>;
  requestPermission(): void;
  show(state: OverlayState): void;
  update(state: OverlayState): void;
  setProgress(progress: number): void;
  setVisible(visible: boolean): void;
  hide(): void;
}

// Under the New Architecture (bridgeless), a legacy ReactPackage module is exposed
// through the TurboModule interop registry, and `NativeModules.X` may be undefined.
// Resolve via TurboModuleRegistry first, then fall back to NativeModules (old arch).
function resolveNative(): FloatingOverlayNative | undefined {
  if (Platform.OS !== 'android') return undefined;
  try {
    const tm = TurboModuleRegistry.get('FloatingOverlay') as unknown as FloatingOverlayNative | null;
    if (tm) return tm;
  } catch {
    // TurboModuleRegistry unavailable (pure old arch) — fall through.
  }
  return NativeModules.FloatingOverlay;
}

const native: FloatingOverlayNative | undefined = resolveNative();

export const overlaySupported = !!native;

export const floatingOverlay = {
  supported: overlaySupported,

  async hasPermission(): Promise<boolean> {
    if (!native) return false;
    try { return await native.hasPermission(); } catch { return false; }
  },

  requestPermission(): void {
    native?.requestPermission();
  },

  show(state: OverlayState): void {
    native?.show(state);
  },

  update(state: OverlayState): void {
    native?.update(state);
  },

  // Position ring, 0..1.
  setProgress(progress: number): void {
    native?.setProgress(progress);
  },

  setVisible(visible: boolean): void {
    native?.setVisible(visible);
  },

  hide(): void {
    native?.hide();
  },

  // Returns an unsubscribe function.
  onAction(cb: (e: OverlayActionEvent) => void): () => void {
    if (!native) return () => {};
    const sub = DeviceEventEmitter.addListener(
      'FloatingOverlayAction',
      (e: OverlayActionEvent) => cb(e),
    );
    return () => sub.remove();
  },
};
