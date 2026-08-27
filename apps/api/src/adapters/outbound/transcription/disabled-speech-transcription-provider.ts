import {
  SpeechTranscriptionProviderError,
  type SpeechTranscriptionProvider,
} from '../../../ports/transcription/speech-transcription-provider.ts';

export class DisabledSpeechTranscriptionProvider
  implements SpeechTranscriptionProvider
{
  public readonly name = 'disabled';
  public readonly model = 'none';
  public readonly dataBoundary = 'owner_controlled';

  public transcribe(): Promise<never> {
    return Promise.reject(
      new SpeechTranscriptionProviderError(
        'Speech transcription is not configured',
        'transcription_not_configured',
      ),
    );
  }
}
