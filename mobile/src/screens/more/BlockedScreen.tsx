// <copyright file="BlockedScreen.tsx" company="John Narey">
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

import { Editorial, Radius, Spacing, Typography } from '../../theme';

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { getKnownLocations, setBlockedUserOptions } from '../../api/blockedUsers';
import type { BlockedUserOptions, KnownLocations } from '../../api/blockedUsers';
import { useAuthStore } from '../../store/auth';
import { useAfterInteractions } from '../../hooks/useDeferredEffect';
import SearchableSelectSheet from '../../components/SearchableSelectSheet';
import BlockedUserRow from '../../components/BlockedUserRow';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'Blocked'>;

// The blocked list can grow into the hundreds, so this screen only previews a
// handful; the full searchable list lives on its own screen behind a link.
const USERS_PREVIEW = 5;

const OPTION_FIELDS: { key: keyof BlockedUserOptions; label: string }[] = [
  { key: 'blockTransfers', label: 'Block transfers' },
  { key: 'blockBrowse', label: 'Block browsing' },
  { key: 'blockSearchResponses', label: "Don't answer their searches" },
  { key: 'blockPrivateMessages', label: 'Block private messages' },
  { key: 'hideRoomMessages', label: 'Hide room messages' },
  { key: 'hideSearchResults', label: 'Hide their search results' },
  { key: 'blockSameIp', label: 'Catch ban evasion (same IP)' },
];

export default function BlockedScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const isAdmin = useAuthStore(state => state.isAdmin);

  const {
    users, ips, places, options, geoAvailable,
    fetch, unblock, unblockAll, blockIp, unblockIp, blockPlace, unblockPlace,
  } = useBlockedUsersStore();
  const [removingAll, setRemovingAll] = useState(false);

  const [cidr, setCidr] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [locations, setLocations] = useState<KnownLocations>({ countries: [], citiesByCountry: {} });
  const [picker, setPicker] = useState<'country' | 'city' | null>(null);

  useAfterInteractions(() => {
    fetch().catch(() => {});
    getKnownLocations().then(setLocations).catch(() => {});
  }, [fetch]);

  const cityOptions = useMemo(
    () => locations.citiesByCountry[country] ?? [],
    [locations.citiesByCountry, country],
  );

  const previewUsers = useMemo(() => users.slice(0, USERS_PREVIEW), [users]);

  const confirmUnblock = (_label: string, action: () => Promise<void>) =>
    action().catch(err => Alert.alert('Error', String(err?.message ?? err)));

  const onBlockIp = async () => {
    if (!cidr.trim()) return;
    setBusy(true);
    try {
      await blockIp(cidr.trim());
      setCidr('');
    } catch (e: any) {
      Alert.alert('Could not block IP', String(e?.response?.data ?? e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const onBlockPlace = async () => {
    if (!country.trim()) return;
    setBusy(true);
    try {
      await blockPlace(country.trim(), city.trim() || undefined);
      setCountry('');
      setCity('');
    } catch (e: any) {
      Alert.alert('Could not block location', String(e?.response?.data ?? e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveAll = () => {
    const count = users.length;
    Alert.alert(
      'Remove all blocked users?',
      `This unblocks all ${count} users and forgets every IP learned from them, so ban evasion detection starts from scratch. Blocked IPs and locations are kept.\n\nThis can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Remove all ${count}`,
          style: 'destructive',
          onPress: async () => {
            setRemovingAll(true);
            try {
              await unblockAll();
            } catch (e: any) {
              Alert.alert('Could not remove blocked users', String(e?.response?.data ?? e?.message ?? e));
            } finally {
              setRemovingAll(false);
            }
          },
        },
      ],
    );
  };

  const onToggleOption = async (key: keyof BlockedUserOptions) => {
    if (!options) return;
    try {
      const updated = await setBlockedUserOptions({ ...options, [key]: !options[key] });
      useBlockedUsersStore.setState({ options: updated });
    } catch (e: any) {
      Alert.alert('Could not update options', String(e?.response?.data ?? e?.message ?? e));
    }
  };

  return (
    <ScrollView contentContainerStyle={s.container} style={s.scroll}>
      {/* Blocked users */}
      <Text style={s.sectionTitle}>BLOCKED USERS ({users.length})</Text>
      <View style={s.group}>
        {users.length === 0 && <Text style={s.empty}>No blocked users</Text>}
        {previewUsers.map(u => (
          <BlockedUserRow
            key={u.username}
            user={u}
            onUnblock={() => confirmUnblock(u.username, () => unblock(u.username))}
            onBlockIp={ip => blockIp(ip).catch(() => {})}
          />
        ))}
        {users.length > USERS_PREVIEW && (
          <Pressable style={s.viewAllRow} onPress={() => navigation.navigate('BlockedUsers')}>
            <Text style={s.viewAllText}>
              View all {users.length} blocked users
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </Pressable>
        )}
      </View>

      {/* Blocked IPs */}
      <Text style={s.sectionTitle}>BLOCKED IPS ({ips.length})</Text>
      <View style={s.group}>
        <View style={s.addRow}>
          <TextInput
            style={s.input}
            placeholder="IP or CIDR (e.g. 1.2.3.0/24)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={cidr}
            onChangeText={setCidr}
          />
          <Pressable onPress={onBlockIp} disabled={!cidr.trim() || busy} style={[s.addBtn, (!cidr.trim() || busy) && s.addBtnDisabled]}>
            <Text style={s.addBtnText}>Block</Text>
          </Pressable>
        </View>
        {ips.length === 0 && <Text style={s.empty}>No blocked IPs</Text>}
        {ips.map(ip => (
          <View key={ip.cidr} style={s.row}>
            <View style={s.rowMain}>
              <Text style={s.rowTitle}>{ip.cidr}</Text>
              {!!ip.reason && <Text style={s.rowSub} numberOfLines={2}>{ip.reason}</Text>}
            </View>
            <Pressable onPress={() => confirmUnblock(ip.cidr, () => unblockIp(ip.cidr))} style={s.unblockBtn}>
              <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
            </Pressable>
          </View>
        ))}
      </View>

      {/* Blocked locations */}
      <Text style={s.sectionTitle}>BLOCKED LOCATIONS ({places.length})</Text>
      <View style={s.group}>
        {!geoAvailable && (
          <Text style={s.warn}>Geo database not loaded — location rules have no effect.</Text>
        )}
        <View style={s.addRow}>
          <Pressable style={[s.select, { flex: 1 }]} onPress={() => setPicker('country')}>
            <Text style={[s.selectText, !country && s.selectPlaceholder]} numberOfLines={1}>
              {country || 'Country'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </Pressable>
          <Pressable
            style={[s.select, { flex: 1 }, !country && s.selectDisabled]}
            disabled={!country}
            onPress={() => setPicker('city')}
          >
            <Text style={[s.selectText, !city && s.selectPlaceholder]} numberOfLines={1}>
              {city || 'City (optional)'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={onBlockPlace} disabled={!country.trim() || busy} style={[s.addBtn, (!country.trim() || busy) && s.addBtnDisabled]}>
            <Text style={s.addBtnText}>Block</Text>
          </Pressable>
        </View>
        {places.length === 0 && <Text style={s.empty}>No blocked locations</Text>}
        {places.map(p => (
          <View key={p.id} style={s.row}>
            <View style={s.rowMain}>
              <Text style={s.rowTitle}>{p.city ? `${p.city}, ${p.country}` : p.country}</Text>
              {!!p.reason && <Text style={s.rowSub} numberOfLines={2}>{p.reason}</Text>}
            </View>
            <Pressable onPress={() => confirmUnblock(p.city ? `${p.city}, ${p.country}` : p.country, () => unblockPlace(p.id))} style={s.unblockBtn}>
              <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
            </Pressable>
          </View>
        ))}
      </View>

      {/* Options */}
      <Text style={s.sectionTitle}>BLOCKING OPTIONS</Text>
      <View style={s.group}>
        {!isAdmin && <Text style={s.warn}>Only administrators can change these.</Text>}
        {OPTION_FIELDS.map(({ key, label }) => (
          <View key={key} style={s.optRow}>
            <Text style={s.optLabel}>{label}</Text>
            <Switch
              value={Boolean(options?.[key])}
              disabled={!isAdmin || !options}
              onValueChange={() => onToggleOption(key)}
              trackColor={{ true: colors.accent }}
            />
          </View>
        ))}
      </View>

      {/* Danger zone — the server only accepts this from an admin */}
      {isAdmin && (
        <>
          <Text style={[s.sectionTitle, s.dangerTitle]}>DANGER ZONE</Text>
          <View style={[s.group, s.dangerGroup]}>
            <Text style={s.dangerText}>
              Unblocks every user on the list and forgets the IPs learned from them. Blocked IPs and
              locations are kept. This can&apos;t be undone.
            </Text>
            <Pressable
              onPress={onRemoveAll}
              disabled={users.length === 0 || removingAll}
              style={[s.removeAllBtn, (users.length === 0 || removingAll) && s.addBtnDisabled]}
            >
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={s.addBtnText}>
                {removingAll ? 'Removing…' : `Remove all ${users.length} blocked users`}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      <SearchableSelectSheet
        visible={picker === 'country'}
        title="Select country"
        placeholder="Search countries…"
        options={locations.countries}
        onSelect={value => {
          setCountry(value);
          setCity('');
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <SearchableSelectSheet
        visible={picker === 'city'}
        title="Select city"
        placeholder="Search cities…"
        options={cityOptions}
        onSelect={value => {
          setCity(value);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: c.bgPrimary },
  container: { padding: Spacing.md, paddingBottom: Spacing.xl },

  sectionTitle: {
    fontSize: Typography.xs,
    color: c.textMuted,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    ...Editorial.heading,
  },
  group: {
    backgroundColor: c.bgElevated,
    overflow: 'hidden',
    ...Editorial.panel,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  rowMain:  { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: Typography.md, color: c.textPrimary, fontWeight: '500' },
  rowSub:   { fontSize: Typography.xs, color: c.textMuted, marginTop: 2 },
  unblockBtn: { paddingLeft: Spacing.sm },

  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  viewAllText: { color: c.accent, fontSize: Typography.sm, fontWeight: '600' },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  input: {
    flex: 2,
    backgroundColor: c.bgPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    color: c.textPrimary,
    fontSize: Typography.sm,
    ...Editorial.control,
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    backgroundColor: c.bgPrimary,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  selectDisabled: { opacity: 0.4 },
  selectText: { flex: 1, color: c.textPrimary, fontSize: Typography.sm },
  selectPlaceholder: { color: c.textMuted },
  addBtn: {
    backgroundColor: c.danger,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: Typography.sm },

  empty: { color: c.textMuted, fontSize: Typography.sm, padding: Spacing.md, textAlign: 'center' },
  warn:  { color: c.textMuted, fontSize: Typography.xs, padding: Spacing.md, fontStyle: 'italic' },

  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  dangerTitle: { color: c.danger },
  dangerGroup: { borderWidth: StyleSheet.hairlineWidth, borderColor: c.danger },
  dangerText: { color: c.textMuted, fontSize: Typography.sm, padding: Spacing.md, paddingBottom: 0 },
  removeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: c.danger,
    borderRadius: Radius.sm,
    margin: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  optLabel: { flex: 1, fontSize: Typography.md, color: c.textPrimary, paddingRight: Spacing.md },
});
