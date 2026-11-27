import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useRef, useState } from 'react';

import { LOCALE_TAGS } from '@/i18n/translate';
import { useLang, useT } from '@/state/settings';
import { color } from '@/theme/tokens';
import { haptic } from '@/ui/haptics';
import { IconButton } from '@/ui/Header';
import { toast } from '@/ui/Toast';

/**
 * Voice-to-text for the "why are you sending this?" field, using the phone's
 * own speech recogniser in the app language. Reports the text so far on every
 * partial result; the caller decides where it goes.
 */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const t = useT();
  const lang = useLang();
  const [listening, setListening] = useState(false);
  // Events are global to the module, so only react to the session this button started.
  const mine = useRef(false);

  useSpeechRecognitionEvent('result', (event) => {
    if (!mine.current) return;
    const transcript = event.results[0]?.transcript;
    if (transcript) onText(transcript);
  });
  useSpeechRecognitionEvent('end', () => {
    mine.current = false;
    setListening(false);
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (!mine.current) return;
    mine.current = false;
    setListening(false);
    // Silence and a manual stop are not failures worth a message.
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      toast(t('send.dictationUnavailable'), 'caution');
    }
  });

  const toggle = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted || !ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        toast(t('send.dictationUnavailable'), 'caution');
        return;
      }
      haptic.press();
      mine.current = true;
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: LOCALE_TAGS[lang],
        interimResults: true,
        continuous: false,
      });
    } catch {
      mine.current = false;
      setListening(false);
      toast(t('send.dictationUnavailable'), 'caution');
    }
  };

  return (
    <IconButton
      icon={listening ? 'mic-off' : 'mic'}
      label={listening ? t('send.listening') : t('send.dictate')}
      tint={listening ? color.red : color.text}
      onPress={() => void toggle()}
    />
  );
}
