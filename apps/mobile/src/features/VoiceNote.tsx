import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '@/state/settings';
import { color, radius, space, touch } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';

/** Notes already played in this app session, so reopening a hold does not talk over the user again. */
const played = new Set<string>();

/**
 * Guardian's spoken explanation of a hold. With `autoPlay` it starts by
 * itself the first time the hold is opened. Renders nothing until the audio
 * has loaded, so a hold without a note shows no dead player.
 */
export function VoiceNote({ url, autoPlay }: { url: string; autoPlay: boolean }) {
  const t = useT();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (!autoPlay || !status.isLoaded || played.has(url)) return;
    played.add(url);
    player.play();
  }, [autoPlay, status.isLoaded, url, player]);

  if (!status.isLoaded) return null;

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || progress >= 1) void player.seekTo(0);
    player.play();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('hold.voiceNote')}. ${status.playing ? t('hold.pause') : t('hold.play')}`}
      onPress={toggle}
      style={styles.note}
    >
      <View style={styles.button}>
        <Icon name={status.playing ? 'pause' : 'play'} size={18} tint={color.onBright} />
      </View>
      <View style={styles.body}>
        <Text variant="smallStrong">{t('hold.voiceNote')}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.comfortable,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: space.sm },
  track: { height: 4, borderRadius: 2, backgroundColor: color.raised, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: color.amber },
});
