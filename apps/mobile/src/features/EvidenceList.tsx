import type { EvidenceItem } from '@holdback/sdk';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { faviconUrl, hostOf } from '@/lib/evidence';
import { useT } from '@/state/settings';
import { color, radius, space, touch } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';

/** Icon for evidence that has no website behind it, by collector. */
function sourceIcon(source: string): IconName {
  if (source.includes('chain') || source.includes('reputation')) return 'link-2';
  if (source.includes('block') || source.includes('sanction')) return 'slash';
  if (source.includes('context') || source.includes('script')) return 'message-circle';
  if (source.includes('history') || source.includes('baseline')) return 'activity';
  return 'search';
}

function Favicon({ item }: { item: EvidenceItem }) {
  const [failed, setFailed] = useState(false);
  const uri = faviconUrl(item.url);
  if (!uri || failed) {
    return (
      <View style={styles.favicon}>
        <Icon name={sourceIcon(item.source)} size={16} tint={color.textMuted} />
      </View>
    );
  }
  return (
    <View style={styles.favicon}>
      <Image
        source={{ uri }}
        style={styles.faviconImage}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const t = useT();
  const host = hostOf(item.url);
  const raises = item.weight > 0;
  const body = (
    <>
      <Favicon item={item} />
      <View style={styles.text}>
        <Text variant="small">{item.detail}</Text>
        {item.quote ? (
          <Text variant="small" tone="muted" style={styles.quote}>
            “{item.quote}”
          </Text>
        ) : null}
        <View style={styles.meta}>
          <Text variant="caption" tone="faint">
            {host ?? item.source.replace(/_/g, ' ')}
            {item.date ? ` · ${item.date.slice(0, 10)}` : ''}
          </Text>
          {host ? <Icon name="external-link" size={12} tint={color.textFaint} /> : null}
        </View>
      </View>
      <Text
        variant="monoSmall"
        tone={raises ? color.amber : item.weight < 0 ? color.lume : 'faint'}
      >
        {raises ? `+${item.weight}` : item.weight}
      </Text>
    </>
  );

  // Only http(s) links are ever opened, and always in the in-app browser tab.
  if (!host || !item.url) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${item.detail}. ${t('common.openLink')}: ${host}`}
      onPress={() => void WebBrowser.openBrowserAsync(item.url!)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/** Evidence items, strongest first as given, each with its source and a link when it has one. */
export function EvidenceList({ items }: { items: readonly EvidenceItem[] }) {
  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <EvidenceRow key={`${item.source}:${item.signal}:${index}`} item={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  row: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    minHeight: touch.min,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  pressed: { backgroundColor: color.raised },
  favicon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: color.raised,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  faviconImage: { width: 18, height: 18 },
  text: { flex: 1, gap: space.xxs },
  quote: { fontStyle: 'italic' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
