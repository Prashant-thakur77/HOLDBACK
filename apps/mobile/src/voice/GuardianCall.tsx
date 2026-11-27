import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from '@elevenlabs/react-native';
import { GuardianError, type HoldReceipt } from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PermissionsAndroid, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { guardian } from '@/data/guardian';
import type { TokenMeta } from '@/data/tokens';
import { describeFailure } from '@/features/messages';
import { formatUnits } from '@/lib/amount';
import { errorDetail } from '@/lib/walletErrors';
import { useLang, useT } from '@/state/settings';
import { color, space } from '@/theme/tokens';
import { BrandMark } from '@/ui/BrandMark';
import { Button } from '@/ui/Button';
import { haptic } from '@/ui/haptics';
import { IconButton } from '@/ui/Header';
import { Notice } from '@/ui/Notice';
import { Text } from '@/ui/Text';
import { useHoldActions } from '@/wallet/useHoldActions';
import { useWallet } from '@/wallet/WalletContext';
import { createWalletSession } from '@/wallet/walletSession';

import { evidenceForAgent, holdStatusForAgent } from './tools';

export interface GuardianCallProps {
  visible: boolean;
  onClose: () => void;
  receipt: HoldReceipt;
  token: TokenMeta;
}

/** Something the voice agent asked for that the user has to approve on screen first. */
interface PendingAsk {
  kind: 'undo' | 'trust';
  resolve: (approved: boolean) => void;
}

/** The pulsing mark in the middle of the call: slow while listening, quicker while Guardian speaks. */
function Orb({ speaking, connected }: { speaking: boolean; connected: boolean }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(
      connected
        ? withRepeat(
            withTiming(1, { duration: speaking ? 520 : 1600, easing: Easing.inOut(Easing.quad) }),
            -1,
            true,
          )
        : withTiming(0, { duration: 200 }),
    );
  }, [speaking, connected, pulse]);
  const halo = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.get() * (speaking ? 0.28 : 0.12) }],
    opacity: 0.25 + pulse.get() * 0.35,
  }));
  return (
    <View style={styles.orb}>
      <Animated.View
        style={[styles.halo, { backgroundColor: speaking ? color.lume : color.ice }, halo]}
      />
      <View style={styles.core}>
        <BrandMark size={72} tint={speaking ? color.lume : color.ice} />
      </View>
    </View>
  );
}

function Call({ onClose, receipt, token }: Omit<GuardianCallProps, 'visible'>) {
  const t = useT();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const { kind, address, signMessage } = useWallet();
  const actions = useHoldActions();
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const [problem, setProblem] = useState<string | null>(null);
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const started = useRef(false);
  const { hold, document } = receipt;
  const amount = formatUnits(BigInt(hold.amount), token.decimals);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setProblem(t('voice.micDenied'));
          return;
        }
        const session = await guardian.voiceSession(hold.pda, lang);
        if (cancelled) return;
        const common = {
          dynamicVariables: session.dynamicVariables,
          onError: (message: string) => setProblem(t('voice.unavailable', { detail: message })),
        };
        // Prefer the short-lived credential the agent minted; a public agent id is the fallback.
        if (session.conversationToken) {
          startSession({
            ...common,
            conversationToken: session.conversationToken,
            connectionType: 'webrtc',
          });
        } else if (session.signedUrl) {
          startSession({ ...common, signedUrl: session.signedUrl, connectionType: 'websocket' });
        } else {
          startSession({ ...common, agentId: session.agentId });
        }
      } catch (error) {
        if (!cancelled) setProblem(t('voice.unavailable', { detail: errorDetail(error) }));
      }
    })();
    return () => {
      cancelled = true;
      endSession();
    };
    // Starts once per mount; the hold and language of that moment define the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Extending needs a session that proves the caller is the sender. A wallet
   * user who has not signed in yet is asked to sign the challenge once.
   */
  const extendAsSender = async (hours: number) => {
    try {
      return await guardian.voiceExtend(hold.pda, hours);
    } catch (error) {
      const needsSession = error instanceof GuardianError && error.status === 401;
      if (!needsSession || kind !== 'mwa' || !address) throw error;
      await createWalletSession(address.toBase58(), signMessage);
      return guardian.voiceExtend(hold.pda, hours);
    }
  };

  /** Puts a question on screen and resolves with the user's answer. */
  const confirmOnScreen = useCallback(
    (askKind: PendingAsk['kind']) =>
      new Promise<boolean>((resolve) => {
        haptic.warning();
        setAsk({ kind: askKind, resolve });
      }),
    [],
  );

  const answer = (approved: boolean) => {
    ask?.resolve(approved);
    setAsk(null);
  };

  useConversationClientTool('get_hold_status', () =>
    holdStatusForAgent(hold, token.symbol, amount, Date.now()),
  );

  useConversationClientTool('explain_evidence', (parameters) =>
    evidenceForAgent(
      document,
      typeof parameters.source === 'string' ? parameters.source : undefined,
    ),
  );

  // Money only moves after a tap on this screen (and the wallet's own approval for wallet users).
  useConversationClientTool('undo_hold', async () => {
    if (hold.status !== 'PENDING') return 'This hold is already settled and cannot be undone.';
    if (!(await confirmOnScreen('undo'))) return 'The user chose not to undo the payment.';
    try {
      await actions.undo(hold);
      haptic.success();
      return 'Done. The payment was undone and the money is back in the sender wallet.';
    } catch (error) {
      const failure = describeFailure(error, t, 'hold');
      return failure.cancelled
        ? 'The user cancelled in their wallet. Nothing changed.'
        : `The undo failed: ${errorDetail(error)}`;
    }
  });

  // The oracle only ever lengthens a window, and only within policy, so the answer reports
  // what actually happened instead of assuming the requested hours were granted.
  useConversationClientTool('extend_hold', async (parameters) => {
    const hours = Math.round(Number(parameters.hours));
    if (!Number.isFinite(hours) || hours < 1) return 'Say how many whole hours to add.';
    try {
      const result = await extendAsSender(hours);
      await actions.refresh();
      return result.extended
        ? `The window was extended. It now ends at ${result.releaseAt}. Tier: ${result.tier}.`
        : `The policy does not allow a longer window. It still ends at ${result.releaseAt}.`;
    } catch (error) {
      return `The window could not be extended: ${errorDetail(error)}`;
    }
  });

  useConversationClientTool('mark_trusted', async () => {
    if (kind !== 'mwa') {
      return 'This account signs in with email and cannot mark recipients as trusted yet.';
    }
    if (!(await confirmOnScreen('trust'))) return 'The user chose not to trust this recipient.';
    try {
      await actions.trust(new PublicKey(hold.recipient));
      return 'Done. This recipient is now in the trusted people list.';
    } catch (error) {
      const failure = describeFailure(error, t, 'hold');
      return failure.cancelled
        ? 'The user cancelled in their wallet. Nothing changed.'
        : `Marking as trusted failed: ${errorDetail(error)}`;
    }
  });

  const connected = status === 'connected';
  const statusText =
    problem || status === 'error'
      ? t('voice.ended')
      : connected
        ? isSpeaking
          ? t('voice.speaking')
          : t('voice.listening')
        : t('voice.connecting');

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      <Text variant="overline" tone="muted" align="center">
        {t('voice.title')}
      </Text>
      <View style={styles.middle}>
        <Orb speaking={connected && isSpeaking} connected={connected} />
        <Text variant="heading" align="center" accessibilityLiveRegion="polite">
          {statusText}
        </Text>
        {problem ? (
          <Notice tone="caution" body={problem} />
        ) : (
          <Text variant="small" tone="muted" align="center">
            {t('voice.hint')}
          </Text>
        )}
      </View>

      {ask ? (
        <View style={styles.ask}>
          <Notice
            tone={ask.kind === 'undo' ? 'danger' : 'caution'}
            body={ask.kind === 'undo' ? t('voice.toolUndoAsk') : t('voice.toolTrustAsk')}
          />
          <Button
            label={ask.kind === 'undo' ? t('hold.undo') : t('trusted.addCta')}
            variant={ask.kind === 'undo' ? 'danger' : 'primary'}
            onPress={() => answer(true)}
          />
          <Button label={t('common.notNow')} variant="ghost" onPress={() => answer(false)} />
        </View>
      ) : (
        <View style={styles.controls}>
          <IconButton
            icon={isMuted ? 'mic-off' : 'mic'}
            label={isMuted ? t('voice.unmute') : t('voice.mute')}
            tint={isMuted ? color.amber : color.text}
            onPress={() => setMuted(!isMuted)}
          />
          <View style={styles.end}>
            <Button label={t('voice.end')} variant="danger" icon="phone-off" onPress={onClose} />
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * "Talk to Guardian": a full-screen voice conversation about one hold. The
 * agent can read the hold's status and evidence and can ask to undo, extend
 * or trust; each of those runs through the same code as the buttons do.
 */
export function GuardianCall({ visible, onClose, receipt, token }: GuardianCallProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <ConversationProvider>
          <Call onClose={onClose} receipt={receipt} token={token} />
        </ConversationProvider>
      ) : null}
    </Modal>
  );
}

const ORB = 200;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ink, paddingHorizontal: space.xl },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  orb: { width: ORB, height: ORB, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: ORB, height: ORB, borderRadius: ORB / 2 },
  core: {
    width: ORB * 0.66,
    height: ORB * 0.66,
    borderRadius: ORB * 0.33,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ask: { gap: space.sm },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  end: { flex: 1 },
});
