import {
  DECISIONS,
  INVESTIGATIONS,
  RULES,
  shortAddress,
  type Channel,
  type Decision,
  type DojoState,
  type Investigation,
  type Move,
  type RevealedClue,
} from '@holdback/dojo';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';

import { useT } from '@/state/settings';
import { color, radius, space } from '@/theme/tokens';
import { Button, type ButtonVariant } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CountdownRing } from '@/ui/CountdownRing';
import { haptic } from '@/ui/haptics';
import { Icon, type IconName } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';

import { useDojoRun } from './useDojoRun';

const CHANNEL_ICON: Record<Channel, IconName> = {
  sms: 'message-square',
  whatsapp: 'message-circle',
  call: 'phone-incoming',
  email: 'mail',
  dm: 'at-sign',
};

const CLUE_ICON: Record<RevealedClue['source'], IconName> = {
  question: 'help-circle',
  identity: 'user-check',
  address: 'shield',
};

const DECISION_STYLE: Record<Decision, { variant: ButtonVariant; icon: IconName }> = {
  pay: { variant: 'secondary', icon: 'arrow-up-right' },
  pay_with_holdback: { variant: 'primary', icon: 'clock' },
  refuse: { variant: 'secondary', icon: 'x' },
  report: { variant: 'danger', icon: 'flag' },
};

/** Round, lives and score, with the round shown as a ring that fills as the run goes on. */
function Hud({ state }: { state: DojoState }) {
  const t = useT();
  const done = Math.min(state.max_rounds, state.done ? state.rounds_survived : state.round - 1);
  return (
    <Card style={styles.hud}>
      <CountdownRing
        size={56}
        strokeWidth={6}
        createdAt={0}
        releaseAt={1}
        tint={color.lume}
        running={false}
        frozenAt={done / state.max_rounds}
      >
        <Text variant="mono">{Math.min(state.round, state.max_rounds)}</Text>
      </CountdownRing>
      <View style={styles.flex}>
        <Text variant="caption" tone="faint">
          {t('dojo.round', {
            round: Math.min(state.round, state.max_rounds),
            max: state.max_rounds,
          })}
        </Text>
        <View
          style={styles.lives}
          accessible
          accessibilityLabel={`${t('dojo.lives')}: ${state.lives}`}
        >
          {Array.from({ length: RULES.startingLives }, (_, i) => (
            <Icon
              key={i}
              name="heart"
              size={16}
              tint={i < state.lives ? color.red : color.hairlineStrong}
            />
          ))}
        </View>
      </View>
      <View style={styles.score}>
        <Text variant="caption" tone="faint">
          {t('dojo.score')}
        </Text>
        <Text variant="heading" tone={state.score >= state.win_score ? color.lume : 'default'}>
          {state.score}
        </Text>
      </View>
    </Card>
  );
}

function Intro({ best, onStart }: { best: number | null; onStart: () => void }) {
  const t = useT();
  const rules: [IconName, string][] = [
    ['layers', t('dojo.ruleRounds', { rounds: RULES.maxRounds })],
    ['heart', t('dojo.ruleLives', { lives: RULES.startingLives })],
    ['target', t('dojo.ruleWin', { score: RULES.winScore })],
    ['search', t('dojo.ruleInvestigate')],
    ['clock', t('dojo.ruleHoldback')],
  ];
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.gap}>
      <Text variant="title" accessibilityRole="header">
        {t('dojo.title')}
      </Text>
      <Text variant="body" tone="muted">
        {t('dojo.intro')}
      </Text>
      <Card style={styles.gap}>
        {rules.map(([icon, text]) => (
          <View key={text} style={styles.rule}>
            <Icon name={icon} size={18} tint={color.lume} />
            <Text variant="small" style={styles.flex}>
              {text}
            </Text>
          </View>
        ))}
      </Card>
      {best !== null ? (
        <Text variant="mono" tone="muted" align="center">
          {t('dojo.best', { score: best })}
        </Text>
      ) : null}
      <Button label={t('dojo.start')} icon="play" onPress={onStart} />
      <Text variant="caption" tone="faint" align="center">
        {t('dojo.offline')}
      </Text>
    </Animated.View>
  );
}

function Recap({ state, onNext }: { state: DojoState; onNext: () => void }) {
  const t = useT();
  const recap = state.last_round;
  if (!recap) return null;
  return (
    <Animated.View entering={FadeInDown.duration(280)} style={styles.gap}>
      <Card accent={recap.correct ? color.lume : color.red} style={styles.gap}>
        <View style={styles.rule}>
          <Icon
            name={recap.correct ? 'check-circle' : 'x-circle'}
            size={24}
            tint={recap.correct ? color.lume : color.red}
          />
          <Text variant="heading" style={styles.flex}>
            {recap.correct ? t('dojo.recapCorrect') : t('dojo.recapWrong')}
          </Text>
          <Text variant="mono" tone={recap.points > 0 ? color.lume : 'muted'}>
            +{recap.points}
          </Text>
        </View>
        <Text variant="bodyStrong">{recap.was_scam ? t('dojo.wasScam') : t('dojo.wasLegit')}</Text>
        <Text variant="small" tone="muted">
          {t(`dojo.outcome.${recap.outcome}`)}
        </Text>
        <View style={styles.gapSmall}>
          {recap.tells.map((tell) => (
            <View key={tell} style={styles.rule}>
              <Icon name="corner-down-right" size={14} tint={color.textFaint} />
              <Text variant="small" style={styles.flex}>
                {tell}
              </Text>
            </View>
          ))}
        </View>
        <Notice tone="neutral" icon="bookmark" body={recap.lesson} />
      </Card>
      <Button
        label={state.done ? t('dojo.seeResult') : t('dojo.next')}
        icon="arrow-right"
        onPress={onNext}
      />
    </Animated.View>
  );
}

function Result({ state, onAgain }: { state: DojoState; onAgain: () => void }) {
  const t = useT();
  const result = state.result;
  if (!result) return null;
  const won = result.outcome === 'won';
  return (
    <Animated.View entering={FadeIn.duration(320)} style={styles.gap}>
      <Card accent={won ? color.lume : color.amber} style={styles.gap}>
        <Text variant="title">{won ? t('dojo.won') : t('dojo.lost')}</Text>
        <Text variant="small" tone="muted">
          {t(`dojo.reason.${result.reason}`, { score: state.win_score })}
        </Text>
        <Text variant="clock" tone={won ? color.lume : color.amber}>
          {result.score}
        </Text>
        <Text variant="small">
          {t('dojo.correct', { n: result.correct_decisions, max: result.rounds_survived })}
        </Text>
        <Text variant="small" tone={result.money_lost > 0 ? color.red : 'muted'}>
          {t('dojo.moneyLost', { amount: result.money_lost })}
        </Text>
        <Text variant="small" tone={result.money_recovered > 0 ? color.lume : 'muted'}>
          {t('dojo.moneyRecovered', { amount: result.money_recovered })}
        </Text>
        <View style={styles.gapSmall}>
          <Text variant="caption" tone="faint">
            {t('dojo.fingerprint')}
          </Text>
          <Text variant="monoSmall" tone="muted" selectable>
            {result.history_sha256}
          </Text>
        </View>
        <Text variant="caption" tone="faint">
          {t('dojo.offline')}
        </Text>
      </Card>
      <Button label={t('dojo.again')} icon="rotate-ccw" onPress={onAgain} />
    </Animated.View>
  );
}

function Round({
  state,
  checking,
  error,
  onMove,
}: {
  state: DojoState;
  checking: boolean;
  error: string | null;
  onMove: (move: Move) => void;
}) {
  const t = useT();
  const scenario = state.scenario;
  if (!scenario) return null;
  const legal = new Set<Move>(state.legal_moves);

  return (
    <Animated.View key={state.round} entering={FadeInDown.duration(300)} style={styles.gap}>
      <Card style={styles.gap}>
        <View style={styles.rule}>
          <Icon name={CHANNEL_ICON[scenario.channel]} size={18} tint={color.ice} />
          <Text variant="smallStrong" style={styles.flex}>
            {scenario.from}
          </Text>
        </View>
        <View style={styles.gapSmall}>
          {scenario.transcript.map((line, index) => (
            <View key={index} style={styles.bubble}>
              <Text variant="small">{line}</Text>
            </View>
          ))}
        </View>
        <View style={styles.ask}>
          <Text variant="caption" tone="faint">
            {t('dojo.asksFor')}
          </Text>
          <Text variant="amount">
            {scenario.ask.amount}
            <Text variant="heading" tone="muted">{`  ${scenario.ask.currency}`}</Text>
          </Text>
          <Text variant="small" tone="muted">
            {scenario.ask.purpose}
          </Text>
          <Text variant="monoSmall" tone="faint">
            {shortAddress(scenario.ask.to)}
          </Text>
        </View>
      </Card>

      {state.revealed_clues.length > 0 ? (
        <Animated.View layout={LinearTransition} style={styles.gapSmall}>
          {state.revealed_clues.map((clue, index) => (
            <Animated.View key={index} entering={FadeInDown.duration(240)} style={styles.clue}>
              <Icon name={CLUE_ICON[clue.source]} size={16} tint={color.amber} />
              <View style={styles.flex}>
                <Text variant="caption" tone="faint">
                  {t(`dojo.clue.${clue.source}`)}
                </Text>
                <Text variant="small">{clue.text}</Text>
              </View>
            </Animated.View>
          ))}
        </Animated.View>
      ) : null}

      {error ? <Notice tone="caution" body={error} /> : null}

      <Section
        title={t('dojo.investigate')}
        action={
          <Text variant="monoSmall" tone="muted">
            {t('dojo.pointsAvailable', { points: state.points_available })}
          </Text>
        }
      >
        <View style={styles.gapSmall}>
          {INVESTIGATIONS.map((move: Investigation) => (
            <Button
              key={move}
              label={t(`dojo.move.${move}`)}
              variant="secondary"
              compact
              loading={move === 'check_address' && checking}
              disabled={!legal.has(move) || checking}
              onPress={() => onMove(move)}
              trailing={
                <Text variant="monoSmall" tone="faint">
                  −{RULES.investigationCost[move]}
                </Text>
              }
            />
          ))}
        </View>
      </Section>

      <Section title={t('dojo.decide')}>
        <View style={styles.decisions}>
          {DECISIONS.map((move: Decision) => (
            <View key={move} style={styles.decision}>
              <Button
                label={t(`dojo.move.${move}`)}
                variant={DECISION_STYLE[move].variant}
                icon={DECISION_STYLE[move].icon}
                disabled={!legal.has(move) || checking}
                onPress={() => onMove(move)}
              />
            </View>
          ))}
        </View>
      </Section>
    </Animated.View>
  );
}

/**
 * Scam Dojo tab: the same game the hosted agent arena plays, here as a
 * single-player practice run on the phone. Each round ends on a recap that
 * shows the truth, the tells and the lesson before the next request appears.
 */
export function DojoScreen() {
  const t = useT();
  const run = useDojoRun();
  // The engine moves to the next round as soon as a decision lands; the recap is held on screen
  // until the player has read it.
  const [recapRound, setRecapRound] = useState<number | null>(null);
  const { state } = run;

  const move = async (chosen: Move) => {
    const decided = (DECISIONS as readonly Move[]).includes(chosen);
    if (decided) haptic.press();
    const round = state?.round ?? null;
    await run.play(chosen);
    if (decided) setRecapRound(round);
  };

  const showingRecap =
    state !== null && recapRound !== null && state.last_round?.round === recapRound;

  return (
    <Screen tabBarInset>
      {state === null ? (
        <Intro best={run.best} onStart={run.start} />
      ) : (
        <>
          <View style={styles.titleRow}>
            <Text variant="heading" style={styles.flex} accessibilityRole="header">
              {t('dojo.title')}
            </Text>
            <Button label={t('dojo.quit')} variant="ghost" compact onPress={run.quit} />
          </View>
          <Hud state={state} />
          {showingRecap ? (
            <Recap state={state} onNext={() => setRecapRound(null)} />
          ) : state.done ? (
            <Result
              state={state}
              onAgain={() => {
                setRecapRound(null);
                run.start();
              }}
            />
          ) : (
            <Round
              state={state}
              checking={run.checking}
              error={run.error}
              onMove={(m) => void move(m)}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
  gapSmall: { gap: space.sm },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  hud: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lives: { flexDirection: 'row', gap: space.xs, marginTop: space.xs },
  score: { alignItems: 'flex-end' },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderTopLeftRadius: radius.sm / 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  ask: {
    gap: space.xxs,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  clue: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.amberDim,
  },
  decisions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  decision: { flexBasis: '47%', flexGrow: 1 },
});
