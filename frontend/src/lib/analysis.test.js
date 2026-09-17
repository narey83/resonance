// <copyright file="analysis.test.js" company="John Narey">
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

import { getLoudness, getWaveform } from './analysis';
import api from './api';

jest.mock('./api', () => ({ get: jest.fn() }));

// The backend answers 204 while a track is still being analysed. Both readers must turn that
// into a plain null rather than handing callers an empty axios body or throwing: every caller
// treats null as "nothing to draw yet", and the whole point of the 204 is that polling during
// an analysis should not look like a failure.
describe('analysis api readers', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  describe.each([
    [
      'getWaveform',
      () => getWaveform('/downloads/a.mp3'),
      '/analysis/waveform',
    ],
    [
      'getLoudness',
      () => getLoudness('/downloads/a.mp3'),
      '/analysis/loudness',
    ],
  ])('%s', (_name, call, endpoint) => {
    it('returns the body on 200', async () => {
      expect.assertions(1);
      const data = { marker: endpoint };
      api.get.mockResolvedValue({ data, status: 200 });

      await expect(call()).resolves.toBe(data);
    });

    it('returns null on 204 rather than the empty body', async () => {
      expect.assertions(1);
      api.get.mockResolvedValue({ data: '', status: 204 });

      await expect(call()).resolves.toBeNull();
    });

    it('still rejects when the path names no file', async () => {
      expect.assertions(1);
      const notFound = Object.assign(new Error('Request failed'), {
        response: { status: 404 },
      });
      api.get.mockRejectedValue(notFound);

      await expect(call()).rejects.toBe(notFound);
    });
  });
});
