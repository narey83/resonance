// <copyright file="TransferDetails.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import { formatBitrate, formatBytes, formatDate } from '../../lib/util';
import { Table } from 'semantic-ui-react';

// Regex patterns for field name formatting
const UPPERCASE_PATTERN = /([A-Z])/gu;
const FIRST_CHAR_PATTERN = /^./u;
const DURATION_PATTERN = /^\d{2}:\d{2}:\d{2}/u;

// Convert camelCase to Title Case with spaces
const formatFieldName = (fieldName) => {
  return fieldName
    .replaceAll(UPPERCASE_PATTERN, ' $1')
    .replace(FIRST_CHAR_PATTERN, (string) => string.toUpperCase())
    .trim();
};

// Format value based on field type
const formatValue = (key, value) => {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  const lowerKey = key.toLowerCase();

  // Format datetime fields
  if (
    (lowerKey.includes('at') || lowerKey.includes('time')) &&
    typeof value === 'string' &&
    value.includes(':')
  ) {
    // Check if it's a duration (HH:MM:SS format)
    if (DURATION_PATTERN.test(value)) {
      return value;
    }

    // Otherwise it's a datetime
    return formatDate(value);
  }

  // Format byte-related fields
  if (lowerKey.includes('bytes') || key === 'size') {
    return formatBytes(value);
  }

  // Format speed
  if (lowerKey.includes('speed')) {
    return formatBitrate(value);
  }

  // Format percentage
  if (lowerKey.includes('percent')) {
    if (typeof value === 'number') {
      return `${value.toFixed(2)}%`;
    }

    return String(value);
  }

  return String(value);
};

const TransferDetails = ({ file }) => {
  // Fields to display in the popup
  const fields = [
    'id',
    'username',
    'direction',
    'filename',
    'size',
    'startOffset',
    'state',
    'requestedAt',
    'enqueuedAt',
    'startedAt',
    'endedAt',
    'bytesTransferred',
    'averageSpeed',
    'bytesRemaining',
    'elapsedTime',
    'percentComplete',
    'remainingTime',
    'attempts',
    'exception',
  ];

  return (
    <Table
      basic="very"
      compact
      size="small"
    >
      <Table.Body>
        {fields.map((field) => {
          const value = file[field];
          return (
            <Table.Row key={field}>
              <Table.Cell style={{ fontWeight: 'bold', paddingRight: '1em' }}>
                {formatFieldName(field)}
              </Table.Cell>
              <Table.Cell>{formatValue(field, value)}</Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
};

export default TransferDetails;
