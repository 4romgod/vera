import {
  SpeechSynthesisProviderError,
  type SpeechSynthesisProvider,
} from '../../../ports/speech/speech-synthesis-provider.ts';

export class DisabledSpeechSynthesisProvider
  implements SpeechSynthesisProvider
{
  public readonly name = 'disabled';
  public readonly model = 'none';
  public readonly voice = 'none';
  public readonly voices: readonly string[] = [];
  public readonly dataBoundary = 'owner_controlled';
  public readonly enabled = false;

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public synthesize(): Promise<never> {
    return Promise.reject(
      new SpeechSynthesisProviderError(
        'Server speech synthesis is not configured',
        'speech_not_configured',
      ),
    );
  }
}
