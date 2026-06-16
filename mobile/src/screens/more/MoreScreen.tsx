import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { useAuthStore } from '../../store/auth';
import { logout } from '../../api/session';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'More'>;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type ParamlessScreen = { [K in keyof MoreStackParamList]: MoreStackParamList[K] extends undefined ? K : never }[keyof MoreStackParamList];

interface MenuItem {
  label:    string;
  icon:     IoniconName;
  screen:   ParamlessScreen;
  subtitle: string;
}

const MENU: MenuItem[] = [
  { label: 'Overview',  icon: 'bar-chart-outline',  screen: 'Overview', subtitle: 'Stats & activity' },
  { label: 'Browse',    icon: 'folder-outline',      screen: 'Browse',   subtitle: 'Browse user shares' },
  { label: 'Rooms',     icon: 'chatbubbles-outline', screen: 'Rooms',    subtitle: 'Soulseek chat rooms' },
  { label: 'Chat',      icon: 'chatbubble-outline',  screen: 'Chat',     subtitle: 'Private messages' },
  { label: 'Tags',      icon: 'pricetag-outline',    screen: 'Tags',     subtitle: 'Edit ID3 tags' },
  { label: 'Analysis',  icon: 'pulse-outline',       screen: 'Analysis', subtitle: 'Key · BPM · Waveform' },
  { label: 'System',    icon: 'server-outline',      screen: 'System',   subtitle: 'Config & logs' },
  { label: 'Settings',  icon: 'settings-outline',    screen: 'Settings', subtitle: 'App preferences' },
];

export default function MoreScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { refreshToken, clearTokens } = useAuthStore();

  const handleLogout = async () => {
    try { if (refreshToken) await logout(refreshToken); } catch {}
    await clearTokens();
  };

  return (
    <ScrollView contentContainerStyle={s.container} style={s.scroll}>
      <View style={s.group}>
        {MENU.map((item, i) => (
          <Pressable
            key={item.screen}
            onPress={() => navigation.navigate(item.screen)}
            style={({ pressed }) => [
              s.row,
              i === 0 && s.rowFirst,
              i === MENU.length - 1 && s.rowLast,
              pressed && s.rowPressed,
            ]}
          >
            <View style={s.iconWrap}>
              <Ionicons color={colors.accent} name={item.icon} size={20} />
            </View>
            <View style={s.rowText}>
              <Text style={s.rowLabel}>{item.label}</Text>
              <Text style={s.rowSub}>{item.subtitle}</Text>
            </View>
            <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={handleLogout}
        style={({ pressed }) => [s.logoutBtn, pressed && s.rowPressed]}
      >
        <Text style={s.logoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:     { flex: 1, backgroundColor: c.bgPrimary },
    container:  { padding: Spacing.lg, gap: Spacing.lg },
    group: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rowFirst:   {},
    rowLast:    { borderBottomWidth: 0 },
    rowPressed: { backgroundColor: c.bgElevated },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: Radius.sm,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowText:    { flex: 1, gap: 2 },
    rowLabel:   { fontSize: Typography.base, fontWeight: '500', color: c.textPrimary },
    rowSub:     { fontSize: Typography.xs, color: c.textMuted },
    logoutBtn: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
      alignItems: 'center',
    },
    logoutText: { fontSize: Typography.base, fontWeight: '600', color: c.danger },
  });
}
