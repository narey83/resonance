// <copyright file="AudioProcessor.js" company="John Narey">
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

// Base class every DSP unit in the processing rack (see ProcessorChain)
// extends. A processor owns its own Web Audio nodes, parameters and
// cleanup — the chain only ever touches it through this interface, never
// its internals, so new processors slot in without the chain changing.
//
// A processor's state can be changed from more than one place — its own
// panel, Performance Mode (see PerformanceProcessor), or a preset (see
// presets.js) — so every panel showing this processor needs to hear about
// changes it didn't itself make, or the UI drifts from what's actually
// playing. subscribe()/snapshot() exist for that: subclasses call
// _notify() at the end of every setter, and call it with the CURRENT
// snapshot immediately on subscribe so a panel that mounts after a preset
// was already applied still starts in sync rather than showing stale
// defaults.
export class AudioProcessor {
  constructor(context) {
    this.context = context;
    this.enabled = false;
    // Set by ProcessorChain.register() — calling setEnabled() before
    // registration (e.g. to restore a persisted default) is a no-op wire,
    // not an error.
    this._onEnabledChange = null;
    this._listeners = new Set();
  }

  // Subclasses must override both — the chain connects
  // previous.getOutputNode() -> this.getInputNode() and reads
  // this.getOutputNode() as the next link's source.
  getInputNode() {
    throw new Error('AudioProcessor subclass must implement getInputNode()');
  }

  getOutputNode() {
    throw new Error('AudioProcessor subclass must implement getOutputNode()');
  }

  // Subclasses with parameters beyond `enabled` should override this to
  // include them, e.g. `{ ...super.snapshot(), amount: this.amount }`.
  snapshot() {
    return { enabled: this.enabled };
  }

  subscribe(listener) {
    this._listeners.add(listener);
    listener(this.snapshot());
    return () => this._listeners.delete(listener);
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this._onEnabledChange?.();
    this._notify();
  }

  _notify() {
    const snap = this.snapshot();
    for (const listener of this._listeners) listener(snap);
  }

  // Subclasses with their own AudioParam ramps/animation frames override
  // this to clean them up; the chain calls it when a processor is removed
  // (not currently exposed in the UI, but supported for completeness).
  dispose() {}
}
