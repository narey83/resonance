import { NativeModules, TurboModuleRegistry } from 'react-native';
export interface StudioMeters { input: number; output: number; reduction: number; correlation: number; buffers: number }
export interface StudioConfig { values: number[]; enabled: boolean; pushed: boolean; bypass: boolean }
interface NativeStudio { configure(config: StudioConfig): Promise<void>; meters(): Promise<StudioMeters> }
let native: NativeStudio | undefined;
try { native = (TurboModuleRegistry.get('ResonanceStudio') ?? NativeModules.ResonanceStudio) as NativeStudio | undefined; } catch { native = NativeModules.ResonanceStudio; }
export const studio = {
  available: !!native,
  configure: async (config: StudioConfig) => { if (!native) throw new Error('Studio needs a new native app build.'); await native.configure(config); },
  meters: async () => native?.meters(),
};
