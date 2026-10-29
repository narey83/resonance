// <copyright file="WorldMap.tsx" company="John Narey">
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

import { Editorial, Spacing, Typography, ThemeColors } from '../../theme';

// Deliberately NOT react-native-maps: that needs a Google Maps SDK key on
// Android and a native rebuild, neither of which fit "works out of the box".
// The web dashboard's own WorldMap.jsx doesn't use Google Maps either — it
// draws an SVG world outline from a free CDN-hosted TopoJSON atlas via
// react-simple-maps. This mirrors that approach with react-native-svg
// (already a linked dependency, so no native rebuild is needed) plus
// topojson-client to turn the same atlas into plain polygons, projected by
// hand with a simple equirectangular formula (skips a full d3-geo
// dependency — good enough for a small admin map, not survey-grade).

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { GeometryObject } from 'geojson';
import type { Topology } from 'topojson-specification';
import { feature } from 'topojson-client';
import { UserReportSummary } from '../../api/analytics';
import { EmptyState } from './shared';

// Same 110m-resolution atlas the web WorldMap.jsx uses — plenty of detail
// for a small on-screen map, ~10x fewer vertices than the 50m version.
const ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const VIEW_W = 800;
const VIEW_H = 400;

const project = (lon: number, lat: number): [number, number] => [
  ((lon + 180) / 360) * VIEW_W,
  ((90 - lat) / 180) * VIEW_H,
];

function ringToPath(ring: number[][]): string {
  return ring.map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${project(lon, lat).join(',')}`).join(' ') + 'Z';
}

function geometryToPath(geometry: GeometryObject): string {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(ringToPath).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((polygon) => polygon.map(ringToPath).join(' ')).join(' ');
  }
  return '';
}

// Module-level cache — the atlas never changes, so fetch it once per app
// session rather than every time the Geography tab is opened.
let atlasPathsCache: string[] | null = null;
let atlasPromise: Promise<string[]> | null = null;

function loadAtlasPaths(): Promise<string[]> {
  if (atlasPathsCache) return Promise.resolve(atlasPathsCache);
  if (!atlasPromise) {
    atlasPromise = fetch(ATLAS_URL)
      .then((r) => r.json())
      .then((topology: Topology) => {
        const objectKey = Object.keys(topology.objects)[0];
        const geo = feature(topology, topology.objects[objectKey]);
        const features = geo.type === 'FeatureCollection' ? geo.features : [geo];
        const paths = features.map((f) => geometryToPath(f.geometry)).filter(Boolean);
        atlasPathsCache = paths;
        return paths;
      })
      .catch(() => {
        atlasPromise = null;
        return [];
      });
  }
  return atlasPromise;
}

const recencyColor = (lastSeen: string | null, colors: ThemeColors): string => {
  if (!lastSeen) return colors.textDim;
  const ageMs = Date.now() - new Date(lastSeen).getTime();
  const hour = 3_600_000;
  if (ageMs < hour) return colors.success;
  if (ageMs < 24 * hour) return colors.accent;
  if (ageMs < 7 * 24 * hour) return colors.warning;
  return colors.textDim;
};

export default function WorldMap({
  users,
  colors,
  onSelectUser,
}: {
  users:        UserReportSummary[];
  colors:       ThemeColors;
  onSelectUser: (username: string) => void;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [countryPaths, setCountryPaths] = useState<string[] | null>(atlasPathsCache);

  useEffect(() => {
    if (countryPaths) return;
    let cancelled = false;
    loadAtlasPaths().then((paths) => { if (!cancelled) setCountryPaths(paths); });
    return () => { cancelled = true; };
  }, [countryPaths]);

  const peers = users.filter((u) => u.lat != null && u.lon != null);

  if (peers.length === 0) {
    return <View style={s.card}><EmptyState text="No geolocated peers in this window." colors={colors} /></View>;
  }

  return (
    <View style={s.card}>
      <Svg width="100%" height={220} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        {(countryPaths ?? []).map((d, i) => (
          <Path key={i} d={d} fill={colors.bgElevated} stroke={colors.border} strokeWidth={0.5} />
        ))}
        {peers.map((u) => {
          const [x, y] = project(u.lon as number, u.lat as number);
          return (
            <Circle
              key={u.username}
              cx={x}
              cy={y}
              r={4}
              fill={recencyColor(u.lastSeen, colors)}
              stroke={colors.bgPrimary}
              strokeWidth={1}
              onPress={() => onSelectUser(u.username)}
            />
          );
        })}
      </Svg>
      <View style={s.legend}>
        <LegendDot color={colors.success} label="< 1h" />
        <LegendDot color={colors.accent} label="< 24h" />
        <LegendDot color={colors.warning} label="< 7d" />
        <LegendDot color={colors.textDim} label="older" />
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: Typography.xs, color }}>{label}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      ...Editorial.panel,
    },
    legend: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      padding: Spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
  });
}
