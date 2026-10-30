import type { TextStyle } from 'react-native';

/** Resolve a static font face so Android and iOS use the same real weight. */
export function brandFont(style: Pick<TextStyle, 'fontFamily' | 'fontWeight'>): string {
  if (style.fontFamily && style.fontFamily !== 'Inter-Regular') return style.fontFamily;
  const weight = style.fontWeight === 'bold' ? 700 : Number(style.fontWeight) || 400;
  if (weight <= 400) return 'Inter-Regular';
  if (weight <= 500) return 'Inter-Medium';
  if (weight <= 600) return 'Inter-SemiBold';
  return 'Inter-Bold';
}
