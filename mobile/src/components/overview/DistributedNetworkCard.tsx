// <copyright file="DistributedNetworkCard.tsx" company="John Narey">
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
// slice: parent -> you -> children, which is the most any single client can
// ever see of the tree.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Spacing, Typography, ThemeColors } from '../../theme';
import { Card, ChainLink, ChainNode, EmptyState, SectionHeader, StatRow, StatTileGrid } from './shared';
import type { AppState } from '../../api/application';

type DistributedNetwork = NonNullable<AppState['distributedNetwork']>;

const MAX_CHILDREN_SHOWN = 10;

function describeRole(net: DistributedNetwork): { label: string; detail: string } {
  if (net.isBranchRoot) {
    return { label: 'Branch Root', detail: 'You take searches straight from the Soulseek server — nobody is upstream of you.' };
  }
  if (!net.hasParent) {
    return { label: 'Not Connected', detail: "You're not currently attached to the search relay network." };
  }
  if (net.children.length > 0) {
    return { label: 'Relay', detail: `You pass searches on to ${net.children.length} peer${net.children.length === 1 ? '' : 's'} below you.` };
  }
  return { label: 'Leaf', detail: "You receive searches but aren't relaying them to anyone else." };
}

export default function DistributedNetworkCard({ data, colors }: { data: DistributedNetwork | null; colors: ThemeColors }) {
  const s = useMemo(() => makeStyles(colors), [colors]);

  if (!data) {
    return (
      <Card colors={colors}>
        <EmptyState text="No distributed network data yet." colors={colors} />
      </Card>
    );
  }

  const role = describeRole(data);
  const parentColor = data.hasParent ? colors.accent : colors.textMuted;
  const childColor  = data.children.length > 0 ? colors.accent : colors.textMuted;
  const shown    = data.children.slice(0, MAX_CHILDREN_SHOWN);
  const overflow = data.children.length - shown.length;

  return (
    <>
      <Text style={s.blurb}>
        Soulseek spreads search requests through a chain of connected clients
        instead of everyone querying the server directly. Where you sit in
        that chain is your &ldquo;level&rdquo; — how many hops you are from
        the top. This is your position right now, and the only two
        connections in it you&apos;re able to see.
      </Text>

      <Card colors={colors}>
        <StatTileGrid
          colors={colors}
          tiles={[
            { key: 'level', label: 'Your Level', value: data.hasParent || data.isBranchRoot ? String(data.branchLevel) : '—' },
            { key: 'role', label: 'Role', value: role.label },
            { key: 'children', label: 'Peers Below You', value: String(data.children.length), sub: `of ${data.childLimit} max` },
            {
              key: 'accepting',
              label: 'Accepting Peers',
              value: data.canAcceptChildren ? 'Yes' : 'No',
              valueColor: data.canAcceptChildren ? colors.success : colors.textMuted,
            },
          ]}
        />
      </Card>
      <Text style={s.roleDetail}>{role.detail}</Text>

      <Card colors={colors}>
        <View style={s.chain}>
          <ChainNode
            icon="arrow-up-circle-outline"
            title={data.hasParent ? (data.parent || 'Unknown peer') : 'No parent'}
            sub={
              data.hasParent ? (data.parentIPEndPoint ?? 'IP unknown')
              : data.isBranchRoot ? 'You are the top of this branch'
              : 'Not attached'
            }
            color={parentColor}
            colors={colors}
          />
          <ChainLink
            title="FEEDS SEARCHES TO"
            status="You"
            chips={[`Level ${data.branchLevel}`, data.branchRoot ? `Branch: ${data.branchRoot}` : null].filter(Boolean) as string[]}
            color={colors.accent}
            live={data.hasParent}
            colors={colors}
          />
          <ChainNode
            icon="person-circle-outline"
            title="You"
            sub={role.label}
            color={colors.accent}
            colors={colors}
          />
          <ChainLink
            title="YOU RELAY TO"
            status={data.children.length > 0 ? `${data.children.length} peer${data.children.length === 1 ? '' : 's'}` : 'Nobody yet'}
            chips={[]}
            color={childColor}
            live={data.children.length > 0}
            colors={colors}
          />
          <ChainNode
            icon="git-branch-outline"
            title={data.children.length > 0 ? `${data.children.length} peer${data.children.length === 1 ? '' : 's'} below` : 'No peers below'}
            sub={data.children.length > 0 ? 'Listed below' : 'Nobody relaying through you right now'}
            color={childColor}
            colors={colors}
          />
        </View>
      </Card>

      {data.children.length > 0 && (
        <>
          <SectionHeader title="Peers Below You" colors={colors} />
          <Card colors={colors}>
            {shown.map((child, i) => (
              <StatRow
                key={`${child.username}-${i}`}
                label={child.username}
                value={child.ipEndPoint ?? '—'}
                colors={colors}
                last={i === shown.length - 1}
              />
            ))}
          </Card>
          {overflow > 0 && <Text style={s.overflowNote}>+ {overflow} more not shown</Text>}
        </>
      )}
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    blurb: {
      fontSize: Typography.sm,
      color: c.textMuted,
      lineHeight: 20,
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.xs,
    },
    roleDetail: {
      fontSize: Typography.sm,
      color: c.textMuted,
      paddingHorizontal: Spacing.sm,
      paddingTop: Spacing.xs,
    },
    chain: { paddingVertical: Spacing.md, paddingRight: Spacing.sm },
    overflowNote: {
      fontSize: Typography.xs,
      color: c.textDim,
      textAlign: 'center',
      paddingTop: Spacing.xs,
    },
  });
}
