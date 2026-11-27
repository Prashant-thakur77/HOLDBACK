import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { hasAgent } from '@/config';
import { confirmPhoneCode, startPhoneVerification } from '@/data/phone';
import { maskPhone, normalisePhone } from '@/lib/phone';
import { errorDetail } from '@/lib/walletErrors';
import { useSettings, useT } from '@/state/settings';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { haptic } from '@/ui/haptics';
import { Notice } from '@/ui/Notice';
import { useWallet } from '@/wallet/WalletContext';

type Stage = 'number' | 'code' | 'verified' | 'saved_only';

/**
 * Adds a phone number for Guardian calls. The number is only "verified" once
 * the agent has confirmed a texted code; when the agent has no phone
 * verification the number is kept on the device and the form says so.
 */
export function PhoneForm({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const { address } = useWallet();
  const setPhone = useSettings((state) => state.setPhone);
  const setPhoneVerified = useSettings((state) => state.setPhoneVerified);
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('number');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalised = normalisePhone(number);
  const wallet = address?.toBase58() ?? null;

  const save = async () => {
    if (!normalised) {
      setError(t('onboarding.phoneInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started =
        hasAgent && wallet ? await startPhoneVerification(wallet, normalised) : 'unsupported';
      setPhone(normalised);
      setStage(started === 'sent' ? 'code' : 'saved_only');
    } catch (cause) {
      setError(t('errors.generic', { detail: errorDetail(cause) }));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!normalised || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      const verified = await confirmPhoneCode(wallet, normalised, code.trim());
      if (!verified) {
        setError(t('settings.phoneCodeWrong'));
        return;
      }
      setPhoneVerified(true);
      haptic.success();
      setStage('verified');
    } catch (cause) {
      setError(t('errors.generic', { detail: errorDetail(cause) }));
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'verified' || stage === 'saved_only') {
    return (
      <View style={styles.form}>
        <Notice
          tone={stage === 'verified' ? 'calm' : 'neutral'}
          title={stage === 'verified' ? t('settings.phoneVerified') : undefined}
          body={
            stage === 'verified' ? maskPhone(normalised ?? '') : t('onboarding.phoneUnsupported')
          }
        />
        {onDone ? <Button label={t('onboarding.finish')} onPress={onDone} /> : null}
      </View>
    );
  }

  if (stage === 'code') {
    return (
      <View style={styles.form}>
        <Field
          label={t('settings.phoneCodeLabel')}
          hint={t('settings.phoneCodeSent', { phone: maskPhone(normalised ?? '') })}
          error={error}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          maxLength={8}
          mono
        />
        <Button
          label={t('settings.phoneVerify')}
          loading={busy}
          disabled={code.trim().length < 4}
          onPress={() => void verify()}
        />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Field
        label={t('onboarding.phoneLabel')}
        placeholder={t('onboarding.phonePlaceholder')}
        error={error}
        value={number}
        onChangeText={(value) => {
          setNumber(value);
          setError(null);
        }}
        keyboardType="phone-pad"
        autoComplete="tel"
        mono
      />
      <Button
        label={t('onboarding.phoneSave')}
        variant="secondary"
        loading={busy}
        disabled={number.trim() === ''}
        onPress={() => void save()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.md },
});
