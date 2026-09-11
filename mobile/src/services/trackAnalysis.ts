// <copyright file="trackAnalysis.ts" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import { Alert } from 'react-native';
import { analyseTracks } from '../api/musicLibrary';
import { forgetWaveformMisses } from '../hooks/useTrackWaveform';
import { useAnalysisProgress } from '../store/analysisProgressStore';

// Only server library tracks can be analysed; on-device files and peer streams have nothing to scan.
const isLibraryPath = (path: string) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(path);

const describe = (e: any): string => {
  const data = e?.response?.data;
  if (typeof data === 'string' && data) return data;
  return e?.message || 'Unknown error';
};

const confirmReset = (label: string) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(
      'Re-analyse from scratch?',
      `This clears the key, BPM, loudness and waveform for ${label} and measures them again.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Re-analyse', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

/**
 * Queues key, BPM, loudness and waveform analysis for the tracks `resolvePaths` returns, reporting
 * the outcome to the user. Results reach the Library lists and the player as each track finishes,
 * through the server's LIBRARY_UPDATED broadcast.
 *
 * @param label how to name the selection in messages, e.g. the track title or `"Folder"`.
 * @param resolvePaths the tracks to analyse, fetched only once the user has committed.
 * @param options.reset clear existing results and measure again, rather than only filling gaps.
 */
export async function requestAnalysis(
  label: string,
  resolvePaths: () => Promise<string[]>,
  { reset = false } = {},
): Promise<void> {
  if (reset && !(await confirmReset(label))) return;

  try {
    const paths = (await resolvePaths()).filter(isLibraryPath);
    if (paths.length === 0) {
      Alert.alert('Nothing to analyse', 'No library tracks were found here.');
      return;
    }

    await analyseTracks(paths, { reset });
    forgetWaveformMisses(paths);
    useAnalysisProgress.getState().markQueued(paths);
    const count = `${paths.length} track${paths.length === 1 ? '' : 's'}`;
    Alert.alert(
      reset ? 'Re-analysis started' : 'Analysis started',
      `${count} queued for key, BPM, loudness and waveform. Each one updates here as soon as it finishes.`,
    );
  } catch (e: any) {
    if (e?.response?.status === 409) {
      Alert.alert(
        'Analysis already running',
        'The server runs one analysis at a time. Try again once the current one finishes.',
      );
    } else {
      Alert.alert('Could not start analysis', describe(e));
    }
  }
}
