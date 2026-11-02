// <copyright file="index.jsx" company="JP Dillingham">
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

import { toast } from '../../../lib/activityNotices';
import * as sharesLibrary from '../../../lib/shares';
import { LoaderSegment, ShrinkableButton, Switch } from '../../Shared';
import ContentsModal from './ContentsModal';
import ExclusionTable from './ExclusionTable';
import ShareTable from './ShareTable';
import React, { useEffect, useState } from 'react';

const ScanButton = ({ rescan, scanPending, working }) => (
  <ShrinkableButton
    color={scanPending ? 'yellow' : undefined}
    disabled={working}
    icon="refresh"
    loading={working}
    mediaQuery="(max-width: 516px)"
    onClick={() => rescan()}
    primary={!scanPending}
  >
    Rescan Shares
  </ShrinkableButton>
);

const CancelButton = ({ cancel, working }) => (
  <ShrinkableButton
    color="red"
    disabled={working}
    icon="x"
    mediaQuery="(max-width: 516px)"
    onClick={() => cancel()}
  >
    Cancel Scan
  </ShrinkableButton>
);

const Shares = ({ onActions, state = {}, theme } = {}) => {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [shares, setShares] = useState([]);
  const [modal, setModal] = useState(false);

  const {
    directories,
    files,
    scanPending,
    scanProgress,
    scannedDirectories,
    scanning,
  } = state;

  const getAll = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);

      const sharesByHost = await sharesLibrary.getAll();
      const flattened = Object.entries(sharesByHost).reduce(
        (accumulator, [host, sharesForHost]) => {
          return accumulator.concat(
            sharesForHost.map((share) => ({ host, ...share })),
          );
        },
        [],
      );

      setShares(flattened);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data ?? error?.message ?? error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAll();
  }, []);

  useEffect(() => {
    getAll(true);

    if (!scanning) {
      // the state change out of scanning can fire before
      // shares are updated, which leaves them stale. wait a second
      // and fetch again.
      setTimeout(() => getAll(true), 1_000);
    }
  }, [scanPending, scanning]);

  const rescan = async () => {
    try {
      setWorking(true);
      await sharesLibrary.rescan();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data ?? error?.message ?? error);
    } finally {
      setWorking(false);
    }
  };

  const cancel = async () => {
    try {
      setWorking(true);
      await sharesLibrary.cancel();
    } catch (error) {
      console.error(error);
      toast.error(
        error?.response?.data ??
          error?.message ??
          error ??
          'Failed to cancel the scan',
      );
    } finally {
      setWorking(false);
    }
  };

  const shared = shares.filter((share) => !share.isExcluded);
  const excluded = shares.filter((share) => share.isExcluded);

  useEffect(() => {
    onActions?.(
      <Switch
        scanning={
          scanning && (
            <CancelButton
              cancel={cancel}
              working={working}
            />
          )
        }
      >
        <ScanButton
          rescan={rescan}
          scanPending={scanPending}
          working={working}
        />
      </Switch>,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanPending, scanning, working]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onActions?.(null), []);

  return (
    <Switch loading={loading && <LoaderSegment />}>
      <Switch
        filling={
          scanning && (
            <LoaderSegment>
              <div>
                <div>{Math.round(scanProgress * 100)}%</div>
                <div className="share-scan-detail">
                  Scanned {scannedDirectories ?? 0} of {directories} folders
                  &middot; found {files} files
                </div>
              </div>
            </LoaderSegment>
          )
        }
      >
        <div className="shares-cards">
          <ShareTable
            onClick={setModal}
            shares={shared}
          />
          <ExclusionTable exclusions={excluded} />
        </div>
      </Switch>
      <ContentsModal
        onClose={() => setModal(false)}
        share={modal}
        theme={theme}
      />
    </Switch>
  );
};

export default Shares;
