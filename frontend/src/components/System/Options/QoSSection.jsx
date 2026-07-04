// <copyright file="QoSSection.jsx" company="John Narey">
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

import React from 'react';

const EMPTY_ENTRY = {
  label: '',
  start: '00:00',
  end: '00:00',
  download_speed_limit: null,
  upload_speed_limit: null,
};

const QoSSection = ({ disabled, onChange, value = [] }) => {
  const update = (index, field, fieldValue) => {
    const next = [...value];
    next[index] = { ...next[index], [field]: fieldValue };
    onChange(next);
  };

  const remove = (index) =>
    onChange(value.filter((_, index_) => index_ !== index));

  const add = () => onChange([...value, { ...EMPTY_ENTRY }]);

  return (
    <div className="info-section">
      <div className="info-section-title">Scheduled Speed Limits</div>
      <div className="info-section-body">
        {value.length === 0 && (
          <div className="qos-empty">
            No schedule configured. Transfers run at the global speed limits at
            all times.
          </div>
        )}
        {value.map((entry, index) => (
          <div
            className="qos-entry"
            // eslint-disable-next-line react/no-array-index-key
            key={index}
          >
            <div className="qos-entry-header">
              <input
                className="opt-input qos-label-input"
                disabled={disabled}
                onChange={(e) => update(index, 'label', e.target.value)}
                placeholder="Label (optional)"
                type="text"
                value={entry.label ?? ''}
              />
              <button
                className="shares-remove-btn"
                disabled={disabled}
                onClick={() => remove(index)}
                title="Remove"
                type="button"
              >
                ×
              </button>
            </div>
            <div className="qos-entry-fields">
              <div className="qos-entry-field">
                <span className="qos-entry-field-label">Start</span>
                <input
                  className="qos-time-input"
                  disabled={disabled}
                  onChange={(e) => update(index, 'start', e.target.value)}
                  type="time"
                  value={entry.start ?? ''}
                />
              </div>
              <div className="qos-entry-field">
                <span className="qos-entry-field-label">End</span>
                <input
                  className="qos-time-input"
                  disabled={disabled}
                  onChange={(e) => update(index, 'end', e.target.value)}
                  type="time"
                  value={entry.end ?? ''}
                />
              </div>
              <div className="qos-entry-field">
                <span className="qos-entry-field-label">Download</span>
                <div className="opt-input-wrap">
                  <input
                    className="opt-input"
                    disabled={disabled}
                    min={0}
                    onChange={(e) =>
                      update(
                        index,
                        'download_speed_limit',
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                    placeholder="unlimited"
                    type="number"
                    value={entry.download_speed_limit ?? ''}
                  />
                  <span className="opt-unit">KiB/s</span>
                </div>
              </div>
              <div className="qos-entry-field">
                <span className="qos-entry-field-label">Upload</span>
                <div className="opt-input-wrap">
                  <input
                    className="opt-input"
                    disabled={disabled}
                    min={0}
                    onChange={(e) =>
                      update(
                        index,
                        'upload_speed_limit',
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                    placeholder="unlimited"
                    type="number"
                    value={entry.upload_speed_limit ?? ''}
                  />
                  <span className="opt-unit">KiB/s</span>
                </div>
              </div>
            </div>
          </div>
        ))}
        <div className="qos-add-row">
          <button
            className="shares-add-btn"
            disabled={disabled}
            onClick={add}
            type="button"
          >
            + Add Window
          </button>
          {value.length > 0 && (
            <span className="qos-hint">
              End earlier than Start spans midnight (e.g. 22:00–06:00). 0 =
              unlimited.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default QoSSection;
