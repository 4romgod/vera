import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultVoicePreferences,
  parseVoicePreferences,
  recommendedDeviceVoices,
  resolveDeviceVoice,
  resolveNeuralVoice,
  sortDeviceVoices,
  type DeviceVoice,
} from '../src/voice/settings/voice-preferences.ts';

const voices: DeviceVoice[] = [
  {
    identifier: 'basic-en-gb',
    language: 'en-GB',
    name: 'Basic British',
    quality: 'Default',
  },
  {
    identifier: 'enhanced-en-us',
    language: 'en-US',
    name: 'Enhanced American',
    quality: 'Enhanced',
  },
  {
    identifier: 'default-en-us',
    isDefault: true,
    language: 'en-US',
    name: 'Default American',
    quality: 'Default',
  },
  {
    identifier: 'enhanced-fr-fr',
    language: 'fr-FR',
    name: 'Enhanced French',
    quality: 'Enhanced',
  },
];

void describe('device voice preferences', () => {
  void it('fails closed to natural defaults when stored settings are absent or malformed', () => {
    assert.deepEqual(parseVoicePreferences(null), defaultVoicePreferences);
    assert.deepEqual(
      parseVoicePreferences('{not json'),
      defaultVoicePreferences,
    );
    assert.deepEqual(
      parseVoicePreferences(JSON.stringify({ schemaVersion: 2 })),
      defaultVoicePreferences,
    );
  });

  void it('normalizes persisted values and strips empty voice identifiers', () => {
    assert.deepEqual(
      parseVoicePreferences(
        JSON.stringify({
          schemaVersion: 1,
          neuralVoiceId: ' anna ',
          voiceId: '   ',
          rate: 99,
          pitch: 0,
        }),
      ),
      {
        schemaVersion: 1,
        neuralVoiceId: 'anna',
        rate: 1.25,
        pitch: 0.8,
      },
    );
  });

  void it('resolves an advertised neural selection and falls back to the server default', () => {
    assert.equal(resolveNeuralVoice(['alba', 'anna'], 'alba', 'anna'), 'anna');
    assert.equal(
      resolveNeuralVoice(['alba', 'anna'], 'alba', 'removed'),
      'alba',
    );
    assert.equal(resolveNeuralVoice(['anna'], 'removed', undefined), 'anna');
  });

  void it('honors an available explicit voice before automatic ranking', () => {
    assert.equal(
      resolveDeviceVoice(voices, 'en-US', 'basic-en-gb')?.identifier,
      'basic-en-gb',
    );
  });

  void it('automatically prefers an enhanced exact-locale voice', () => {
    assert.equal(
      resolveDeviceVoice(voices, 'en_US')?.identifier,
      'enhanced-en-us',
    );
    assert.deepEqual(
      sortDeviceVoices(voices, 'en-US').map((voice) => voice.identifier),
      ['enhanced-en-us', 'default-en-us', 'basic-en-gb', 'enhanced-fr-fr'],
    );
  });

  void it('falls back safely when a saved voice does not exist on this device', () => {
    assert.equal(
      resolveDeviceVoice(voices, 'en-US', 'voice-from-another-device')
        ?.identifier,
      'enhanced-en-us',
    );
  });

  void it('uses the platform default instead of guessing among unranked novelty voices', () => {
    assert.equal(
      resolveDeviceVoice(
        voices.map((voice) => ({
          ...voice,
          isDefault: undefined,
          quality: 'Default',
        })),
        'en-US',
      ),
      undefined,
    );
  });

  void it('does not present ordinary novelty voices as recommendations', () => {
    const noveltyVoice: DeviceVoice = {
      identifier: 'novelty-en-us',
      language: 'en-US',
      name: 'Boing',
      quality: 'Default',
    };

    assert.deepEqual(
      recommendedDeviceVoices([...voices, noveltyVoice], 'en-US').map(
        (voice) => voice.identifier,
      ),
      ['enhanced-en-us', 'default-en-us'],
    );
  });
});
