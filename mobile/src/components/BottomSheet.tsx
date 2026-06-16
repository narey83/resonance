import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';

interface Props {
  visible:  boolean;
  onClose:  () => void;
  children: React.ReactNode;
}

/**
 * Modal bottom sheet that stays above the keyboard.
 *
 * Structure:
 *   KeyboardAvoidingView (flex: 1, semi-transparent bg)
 *     Pressable (flex: 1)   ← dim area; tap to dismiss
 *     children              ← sheet content, anchored at bottom
 *
 * When the keyboard opens, KAV shrinks its usable height (iOS: padding,
 * Android: height), which pushes the sheet above the keyboard automatically.
 * Children are responsible for their own background / border-radius styling.
 */
export default function BottomSheet({ visible, onClose, children }: Props) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <Pressable style={styles.dismiss} onPress={onClose} />
        {children}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
});
