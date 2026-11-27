import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Linking, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { parseScannedCode, type ScannedPayment } from '@/lib/recipient';
import { useT } from '@/state/settings';
import { color, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { haptic } from '@/ui/haptics';
import { IconButton } from '@/ui/Header';
import { Text } from '@/ui/Text';

/**
 * Full-screen QR scanner. It reports the first code that is a Solana address,
 * a name or a payment request and ignores everything else, so pointing it at
 * an unrelated QR code does nothing.
 */
export function QrScanner({
  visible,
  onClose,
  onResult,
}: {
  visible: boolean;
  onClose: () => void;
  onResult: (payment: ScannedPayment) => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  useEffect(() => {
    if (!visible) return;
    handled.current = false;
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible, permission, requestPermission]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              const payment = parseScannedCode(data);
              if (!payment) return;
              handled.current = true;
              haptic.success();
              onResult(payment);
            }}
          />
        ) : (
          <View style={styles.denied}>
            <Text variant="heading" align="center">
              {t('scan.permissionTitle')}
            </Text>
            <Text variant="small" tone="muted" align="center">
              {t('scan.permissionBody')}
            </Text>
            <Button
              label={t('settings.openSystemSettings')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          </View>
        )}
        <View style={[styles.top, { top: insets.top + space.md }]}>
          <IconButton icon="x" label={t('common.close')} onPress={onClose} />
        </View>
        {permission?.granted ? (
          <>
            <View style={styles.frame} pointerEvents="none" />
            <View
              style={[styles.caption, { bottom: insets.bottom + space.xxxl }]}
              pointerEvents="none"
            >
              <Text variant="smallStrong" align="center">
                {t('scan.hint')}
              </Text>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: space.xl },
  frame: {
    width: 248,
    height: 248,
    borderRadius: radius.xl,
    borderWidth: 3,
    borderColor: color.lume,
  },
  caption: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.scrim,
  },
  denied: { padding: space.xxl, gap: space.lg, alignItems: 'center' },
});
