// <copyright file="ProcessorChain.js" company="John Narey">
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

// Orchestrates an ordered list of AudioProcessor units between a fixed
// input node and a fixed output node, wiring only the ENABLED ones into
// the signal path — a disabled processor's nodes stay created (so toggling
// it back on is instant and click-free) but disconnected from everything,
// so the Web Audio renderer never pulls them and they cost nothing.
//
// Every enable/disable and every reorder is a full rewire: disconnect
// everything this chain owns, then reconnect input -> [enabled processors,
// in order] -> output. For a handful of processors this is a handful of
// connect()/disconnect() calls, not a hot path, so there's no need for a
// cleverer incremental diff.
export class ProcessorChain {
  constructor(context, inputNode, outputNode) {
    this.context = context;
    this.input = inputNode;
    this.output = outputNode;
    this.entries = [];
  }

  register(id, processor) {
    // eslint-disable-next-line no-underscore-dangle
    processor._onEnabledChange = () => this._rewire();
    this.entries.push({ id, processor });
    this._rewire();
    return processor;
  }

  get(id) {
    return this.entries.find((entry) => entry.id === id)?.processor;
  }

  // Optional reordering support (drag-to-reorder isn't wired up in the UI
  // yet, but the chain doesn't need to change when it is).
  setOrder(orderedIds) {
    const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    if (reordered.length !== this.entries.length) return;
    this.entries = reordered;
    this._rewire();
  }

  _rewire() {
    this.input.disconnect();
    for (const { processor } of this.entries) {
      processor.getOutputNode().disconnect();
    }

    let current = this.input;
    for (const { processor } of this.entries) {
      if (!processor.enabled) continue;
      current.connect(processor.getInputNode());
      current = processor.getOutputNode();
    }

    current.connect(this.output);
  }
}
