// <copyright file="LinkPreviewCard.jsx" company="John Narey">
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

import { getPreview } from '../../lib/linkPreview';
import { Globe } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const hostname = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const LinkPreviewCard = ({ url }) => {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);

    getPreview({ url }).then((result) => {
      if (!cancelled) setPreview(result);
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (
    !preview ||
    (!preview.title && !preview.description && !preview.imageUrl)
  ) {
    return null;
  }

  return (
    <a
      className="link-preview-card"
      href={url}
      onClick={(e) => e.stopPropagation()}
      rel="noopener noreferrer"
      target="_blank"
    >
      {preview.imageUrl && (
        <div className="link-preview-image">
          <img
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.parentElement.style.display = 'none';
            }}
            src={preview.imageUrl}
          />
        </div>
      )}
      <div className="link-preview-body">
        <span className="link-preview-site">
          <Globe
            size={11}
            strokeWidth={2}
          />
          {preview.siteName || hostname(url)}
        </span>
        {preview.title && (
          <span className="link-preview-title">{preview.title}</span>
        )}
        {preview.description && (
          <span className="link-preview-desc">{preview.description}</span>
        )}
      </div>
    </a>
  );
};

export default LinkPreviewCard;
