import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * Short sounds for the three moments a payment changes hands: placed on hold,
 * returned to the sender, released to the recipient. Generated once with the
 * ElevenLabs sound-effects API and bundled. Like haptics, a sound is a nicety:
 * a failure to play must never break a flow.
 */
const SOURCES = {
  placed: require('../../assets/sounds/hold-placed.mp3') as number,
  returned: require('../../assets/sounds/money-returned.mp3') as number,
  released: require('../../assets/sounds/released.mp3') as number,
};

export type SoundName = keyof typeof SOURCES;

const players = new Map<SoundName, AudioPlayer>();

function player(name: SoundName): AudioPlayer {
  let existing = players.get(name);
  if (!existing) {
    existing = createAudioPlayer(SOURCES[name]);
    players.set(name, existing);
  }
  return existing;
}

export function playSound(name: SoundName): void {
  try {
    const sound = player(name);
    void sound.seekTo(0);
    sound.play();
  } catch {
    // No audio output available: stay silent.
  }
}
