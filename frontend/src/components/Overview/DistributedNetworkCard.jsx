// <copyright file="DistributedNetworkCard.jsx" company="John Narey">
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

// Soulseek doesn't expose a global map of the distributed search network —
// each client only ever knows its own parent (who feeds it search requests)
// and its own children (who it relays them to). This card shows exactly that
// slice: parent -> you -> children, the most any single client can ever see
// of the tree. Mirrors mobile's DistributedNetworkCard.tsx.

import AppContext from '../AppContext';
import React, { useContext } from 'react';

const MAX_CHILDREN_SHOWN = 10;

const describeRole = (net) => {
  if (net.isBranchRoot) {
    return {
      detail:
        'You take searches straight from the Soulseek server — nobody is upstream of you.',
      label: 'Branch Root',
    };
  }

  if (!net.hasParent) {
    return {
      detail: "You're not currently attached to the search relay network.",
      label: 'Not Connected',
    };
  }

  if (net.children.length > 0) {
    return {
      detail: `You pass searches on to ${net.children.length} peer${net.children.length === 1 ? '' : 's'} below you.`,
      label: 'Relay',
    };
  }

  return {
    detail: "You receive searches but aren't relaying them to anyone else.",
    label: 'Leaf',
  };
};

const DistributedNetworkCard = () => {
  const { state } = useContext(AppContext);
  const net = state?.distributedNetwork;

  if (!net) {
    return (
      <div className="section-card">
        <div className="section-card-header">
          <span className="section-card-title">Distributed Network</span>
        </div>
        <div className="dir-empty">No distributed network data yet.</div>
      </div>
    );
  }

  const role = describeRole(net);
  const children = net.children ?? [];
  const shown = children.slice(0, MAX_CHILDREN_SHOWN);
  const overflow = children.length - shown.length;
  const parentLive = net.hasParent;
  const childrenLive = children.length > 0;

  return (
    <>
      <p className="distnet-blurb">
        Soulseek spreads search requests through a chain of connected clients
        instead of everyone querying the server directly. Where you sit in that
        chain is your &ldquo;level&rdquo; — how many hops you are from the top.
        This is your position right now, and the only two connections in it
        you&apos;re able to see.
      </p>

      <div className="kpi-cards distnet-kpis">
        <div className="kpi-card">
          <div className="kpi-card-label">Your Level</div>
          <div className="kpi-card-value">
            {net.hasParent || net.isBranchRoot ? net.branchLevel : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-label">Role</div>
          <div className="kpi-card-value">{role.label}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-label">Peers Below You</div>
          <div className="kpi-card-value">{children.length}</div>
          <div className="kpi-card-sub">of {net.childLimit} max</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-label">Accepting Peers</div>
          <div
            className="kpi-card-value"
            style={{
              color: net.canAcceptChildren
                ? 'var(--success)'
                : 'var(--text-muted)',
            }}
          >
            {net.canAcceptChildren ? 'Yes' : 'No'}
          </div>
        </div>
      </div>
      <p className="distnet-role-detail">{role.detail}</p>

      <div className="section-card distnet-chain-card">
        <div className="distnet-chain">
          <div className="distnet-node">
            <div className={`distnet-node-icon${parentLive ? ' active' : ''}`}>
              ↑
            </div>
            <div className="distnet-node-text">
              <div className="distnet-node-title">
                {net.hasParent ? net.parent || 'Unknown peer' : 'No parent'}
              </div>
              <div className="distnet-node-sub">
                {net.hasParent
                  ? net.parentIPEndPoint ?? 'IP unknown'
                  : net.isBranchRoot
                    ? 'You are the top of this branch'
                    : 'Not attached'}
              </div>
            </div>
          </div>

          <div className={`distnet-link${parentLive ? ' live' : ''}`}>
            <div className="distnet-link-text">
              <span className="distnet-link-title">Feeds searches to</span>
              <span className="distnet-link-status">
                You · Level {net.branchLevel}
                {net.branchRoot ? ` · Branch: ${net.branchRoot}` : ''}
              </span>
            </div>
          </div>

          <div className="distnet-node">
            <div className="distnet-node-icon active distnet-node-icon--you">
              ●
            </div>
            <div className="distnet-node-text">
              <div className="distnet-node-title">You</div>
              <div className="distnet-node-sub">{role.label}</div>
            </div>
          </div>

          <div className={`distnet-link${childrenLive ? ' live' : ''}`}>
            <div className="distnet-link-text">
              <span className="distnet-link-title">You relay to</span>
              <span className="distnet-link-status">
                {childrenLive
                  ? `${children.length} peer${children.length === 1 ? '' : 's'}`
                  : 'Nobody yet'}
              </span>
            </div>
          </div>

          <div className="distnet-node">
            <div
              className={`distnet-node-icon${childrenLive ? ' active' : ''}`}
            >
              ↓
            </div>
            <div className="distnet-node-text">
              <div className="distnet-node-title">
                {childrenLive
                  ? `${children.length} peer${children.length === 1 ? '' : 's'} below`
                  : 'No peers below'}
              </div>
              <div className="distnet-node-sub">
                {childrenLive
                  ? 'Listed below'
                  : 'Nobody relaying through you right now'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {children.length > 0 && (
        <>
          <div className="section-card distnet-children-card">
            <div className="section-card-header">
              <span className="section-card-title">Peers Below You</span>
            </div>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Peer</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.username}>
                    <td>{c.username}</td>
                    <td>{c.ipEndPoint ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overflow > 0 && (
            <p className="distnet-overflow">+ {overflow} more not shown</p>
          )}
        </>
      )}
    </>
  );
};

export default DistributedNetworkCard;
