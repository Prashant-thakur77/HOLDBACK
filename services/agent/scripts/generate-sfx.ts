/**
 * Generates the three interface sounds with the ElevenLabs sound-effects
 * API and writes them to `assets/sfx/`. Run once; the app bundles the files.
 *
 *   npm run voice:sfx --workspace services/agent
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadEnv, packageRoot, requireVar } from './env';

const API = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128';

interface Sound {
  file: string;
  /** What the sound should be. */
  text: string;
  durationSeconds: number;
}

const SOUNDS: Sound[] = [
  {
    file: 'hold-placed.mp3',
    text: 'A soft, low two-note chime with a gentle click, like a small vault door settling shut. Calm and reassuring, clean, no reverb tail, user interface sound.',
    durationSeconds: 1.2,
  },
  {
    file: 'money-returned.mp3',
    text: 'A warm rising three-note marimba arpeggio with a soft whoosh in reverse, like something coming back to you. Relieved and bright, user interface sound.',
    durationSeconds: 1.5,
  },
  {
    file: 'released.mp3',
    text: 'A single clear bell tone with a light airy swish moving away. Neutral and finished, short, user interface sound.',
    durationSeconds: 1.0,
  },
];

async function main(): Promise<void> {
  const apiKey = requireVar(loadEnv(), 'ELEVENLABS_API_KEY');
  const outDir = join(packageRoot, 'assets', 'sfx');
  mkdirSync(outDir, { recursive: true });
  for (const sound of SOUNDS) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: sound.text,
        duration_seconds: sound.durationSeconds,
        prompt_influence: 0.6,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `${sound.file}: the API answered ${response.status}: ${await response.text()}`,
      );
    }
    const audio = Buffer.from(await response.arrayBuffer());
    writeFileSync(join(outDir, sound.file), audio);
    console.log(`${sound.file}: ${audio.length} bytes`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
