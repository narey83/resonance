// <copyright file="Mobile.jsx" company="John Narey">
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

import './Mobile.css';
import { getYaml, updateYaml } from '../../../lib/options';
import { createPairingCode, getPairingStatus } from '../../../lib/session';
import QRCode from 'qrcode';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Icon,
  Input,
  Loader,
  Message,
} from 'semantic-ui-react';
import { parse, stringify } from 'yaml';

// Where the toggle lives in the options document.
const SECTION = 'web';
const KEY = 'mobile_pairing';

const readEnabled = (doc) => Boolean(doc?.[SECTION]?.[KEY]);

const Mobile = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [serverUrl, setServerUrl] = useState(window.location.origin);
  const [pairing, setPairing] = useState(null); // { code, expiresIn }
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [qr, setQr] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [paired, setPaired] = useState(null); // { deviceName, redeemedAtUtc }

  useEffect(() => {
    (async () => {
      try {
        setEnabled(readEnabled(parse(await getYaml())));
      } catch (loadError) {
        setError(
          loadError?.response?.data ??
            loadError?.message ??
            'Could not read options',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Re-read, patch the single key and write the document back. Editing the parsed document rather
  // than the text keeps every other option exactly as the user left it.
  const toggle = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      const doc = parse(await getYaml()) ?? {};
      const next = !enabled;

      doc[SECTION] = { ...doc[SECTION], [KEY]: next };
      await updateYaml({ yaml: stringify(doc) });

      setEnabled(next);

      if (!next) {
        setPairing(null);
        setQr(null);
        setPaired(null);
      }
    } catch (saveError) {
      setError(
        saveError?.response?.data ??
          saveError?.message ??
          'Could not save options',
      );
    } finally {
      setSaving(false);
    }
  }, [enabled]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);

    try {
      const result = await createPairingCode();
      setPaired(null);
      setPairing(result);
      setSecondsLeft(result.expiresIn);

      // The phone needs to know where to connect as well as how to authenticate, and the address
      // the browser is on is not necessarily reachable from the phone — hence an editable field
      // rather than assuming the origin.
      const payload = JSON.stringify({
        code: result.code,
        url: serverUrl.trim(),
        v: 1,
      });

      setQr(
        await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 320,
        }),
      );
    } catch (generateError) {
      setError(
        generateError?.response?.status === 403
          ? 'Pairing is disabled on the server.'
          : generateError?.response?.data ??
              generateError?.message ??
              'Could not create a code',
      );
    } finally {
      setGenerating(false);
    }
  }, [serverUrl]);

  // Watch for the phone picking the code up. There is no push channel for this, and a code is
  // only live for a few minutes, so a slow poll is enough and costs nothing when idle.
  useEffect(() => {
    if (!pairing) return undefined;

    const poll = setInterval(async () => {
      try {
        const status = await getPairingStatus(pairing.code);

        if (status?.redeemed) {
          setPaired({
            deviceName: status.deviceName,
            redeemedAtUtc: status.redeemedAtUtc,
          });
          // Retire the QR the moment it is spent — leaving a used code on screen invites a
          // second scan that can only fail.
          setPairing(null);
          setQr(null);
        }
      } catch {
        // Transient; the next tick tries again.
      }
    }, 2_000);

    return () => clearInterval(poll);
  }, [pairing]);

  // Count the code down and drop it when it dies, so a stale QR is never left on screen looking
  // usable. The server would reject it anyway; this just avoids a confusing scan.
  useEffect(() => {
    if (!pairing) return undefined;

    const timer = setInterval(() => {
      setSecondsLeft((left) => {
        if (left <= 1) {
          setPairing(null);
          setQr(null);
          return 0;
        }

        return left - 1;
      });
    }, 1_000);

    return () => clearInterval(timer);
  }, [pairing]);

  if (loading)
    return (
      <Loader
        active
        inline="centered"
      />
    );

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <div className="mobile-pane">
      <div className="mobile-section">
        <Checkbox
          checked={enabled}
          disabled={saving}
          label="Allow pairing a phone by QR code"
          onChange={toggle}
          toggle
        />
        <div className="mobile-hint">
          Lets the mobile app sign in by scanning a code instead of typing the
          server address and your account details. Redeeming a code has to work
          without an existing session, so the endpoint is left closed until you
          turn this on.
        </div>
      </div>

      {error ? (
        <Message
          content={String(error)}
          negative
          size="small"
        />
      ) : null}

      {enabled ? (
        <div className="mobile-section">
          <div className="mobile-label">
            Server address the phone should use
          </div>
          <Input
            fluid
            onChange={(_, { value }) => setServerUrl(value)}
            placeholder="https://resonance.example.com"
            value={serverUrl}
          />
          <div className="mobile-hint">
            Defaults to this page&apos;s address. Change it if your phone
            reaches the server on a different one.
          </div>

          <Button
            className="mobile-generate"
            disabled={generating || !serverUrl.trim()}
            loading={generating}
            onClick={generate}
            primary
          >
            <Icon name="qrcode" />
            {pairing ? 'New code' : 'Show pairing code'}
          </Button>

          {paired ? (
            <Message
              positive
              size="small"
            >
              <Icon name="check circle" />
              Paired with <strong>{paired.deviceName || 'a device'}</strong>. It
              is signed in and will appear in your sessions list.
            </Message>
          ) : null}

          {qr ? (
            <div className="mobile-qr">
              <img
                alt="Pairing QR code"
                src={qr}
              />
              <div className="mobile-countdown">
                Expires in {mmss} · single use
              </div>
              <div className="mobile-hint">
                In the app, tap <strong>Scan QR</strong> on the sign-in screen.
                The code signs in your Resonance account — it is not your
                Soulseek login, and the code itself carries no password.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default Mobile;
