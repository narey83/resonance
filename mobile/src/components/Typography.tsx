import React, { createContext, forwardRef, useContext, useMemo } from 'react';
import {
  Platform,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { isLoaded } from 'expo-font';
import { brandFont } from '../lib/brandTypography';

type FontStyle = Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'fontStyle'>;
const InheritedFont = createContext<FontStyle>({});

function fontStyle(style: FontStyle): TextStyle {
  const family = brandFont(style);
  const bundled = family.startsWith('Inter-') || family === 'Outfit-SemiBold';
  if (!isLoaded(family)) return bundled ? { fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif' } : {};
  // Each bundled file is a real face; prevent a second synthetic weight.
  return { fontFamily: family, ...(bundled ? { fontWeight: 'normal' } : {}) };
}

/** Preserve native props, refs and nested text inheritance. Never changes icon fonts. */
export const Text = forwardRef<NativeText, TextProps>(function Text({ style, children, ...props }, ref) {
  const inherited = useContext(InheritedFont);
  const flat = StyleSheet.flatten(style);
  const family = flat?.fontFamily ?? inherited.fontFamily;
  const weight = flat?.fontWeight ?? inherited.fontWeight;
  const italic = flat?.fontStyle ?? inherited.fontStyle;
  const font = useMemo(() => ({ fontFamily: family, fontWeight: weight, fontStyle: italic }), [family, weight, italic]);
  return (
    <InheritedFont.Provider value={font}>
      <NativeText {...props} ref={ref} style={[style, fontStyle(font)]}>{children}</NativeText>
    </InheritedFont.Provider>
  );
});

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <NativeTextInput {...props} ref={ref} style={[style, fontStyle(StyleSheet.flatten(style) ?? {})]} />;
});
