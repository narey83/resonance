import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import { remoteLog } from '../api/remoteLogger';

// Android suspends a non-exempt app's background work under Doze (screen off + unplugged +
// stationary). For a streaming player that means playback stalls/stops shortly after the phone is
// locked — and aggressive ROMs (e.g. GrapheneOS) apply it quickly. The fix is to ask the user to
// exempt the app from battery optimization, after which the foreground media service keeps running
// (and keeps network) through Doze. Verified on-device: whitelisted playback survives forced deep
// Doze; non-whitelisted stalls. See android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.

const ASKED_KEY = 'battery_exemption_asked_v1';

// android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS — shows a one-tap system
// dialog ("Allow … to ignore battery optimizations?") targeting our package.
const ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS =
  'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS';

const packageName = (): string | null =>
  Constants.expoConfig?.android?.package ?? null;

/**
 * Prompt the user (once, ever) to exempt the app from battery optimization so background playback
 * survives Doze. No-op on iOS, if already asked, or if the package name can't be resolved. The
 * system dialog itself short-circuits when the app is already exempt.
 */
export async function promptBatteryExemptionOnce(): Promise<void> {
  if (Platform.OS !== 'android') return;

  let asked = false;
  try { asked = (await SecureStore.getItemAsync(ASKED_KEY)) === '1'; } catch { /* treat as not asked */ }
  if (asked) return;

  const pkg = packageName();
  if (!pkg) return;

  // Mark asked up-front so a launch failure / repeated mounts don't nag on every start.
  try { await SecureStore.setItemAsync(ASKED_KEY, '1'); } catch { /* best effort */ }

  try {
    await IntentLauncher.startActivityAsync(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
      data: `package:${pkg}`,
    });
  } catch (err: unknown) {
    remoteLog('warn', `[battery] exemption prompt failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}
