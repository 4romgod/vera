import { useRef, useState, type RefObject } from 'react';
import { fetch as expoFetch } from 'expo/fetch';
import * as DocumentPicker from 'expo-document-picker';
import type { AttachmentReference, VeraClient } from '@vera/client';
import type { ComposerAttachment } from './message-composer.tsx';

const MAX_ATTACHMENTS = 5;
const DOCUMENT_ATTACHMENT_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
] as const;
const IMAGE_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/tiff',
] as const;
const SUPPORTED_ATTACHMENT_TYPES = [
  ...DOCUMENT_ATTACHMENT_TYPES,
  ...IMAGE_ATTACHMENT_TYPES,
] as const;
type AttachmentUpload = ComposerAttachment & {
  bytes?: ArrayBuffer;
  previewUri?: string;
};

function attachmentMediaType(
  filename: string,
  declared?: string,
): AttachmentReference['mediaType'] | undefined {
  const normalized = declared?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    normalized !== undefined &&
    (SUPPORTED_ATTACHMENT_TYPES as readonly string[]).includes(normalized)
  ) {
    return normalized as AttachmentReference['mediaType'];
  }
  const extension = filename.toLowerCase().split('.').at(-1);
  return extension === 'pdf'
    ? 'application/pdf'
    : extension === 'md' || extension === 'markdown'
      ? 'text/markdown'
      : extension === 'json'
        ? 'application/json'
        : extension === 'txt' || extension === 'log'
          ? 'text/plain'
          : extension === 'jpg' || extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'png'
              ? 'image/png'
              : extension === 'webp'
                ? 'image/webp'
                : extension === 'gif'
                  ? 'image/gif'
                  : extension === 'heic'
                    ? 'image/heic'
                    : extension === 'heif'
                      ? 'image/heif'
                      : extension === 'avif'
                        ? 'image/avif'
                        : extension === 'tif' || extension === 'tiff'
                          ? 'image/tiff'
                          : undefined;
}

function attachmentRequestKey(): string {
  return `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useAttachments(options: {
  client: VeraClient;
  mounted: RefObject<boolean>;
  onError: (message: string | undefined) => void;
}) {
  const { client, mounted } = options;
  const setError = options.onError;
  const [attachments, setAttachments] = useState<AttachmentUpload[]>([]);
  const [attaching, setAttaching] = useState(false);
  const attachmentPickerActive = useRef(false);

  async function uploadAttachment(upload: AttachmentUpload): Promise<void> {
    if (upload.bytes === undefined) return;
    setAttachments((current) =>
      current.map((item) =>
        item.localId === upload.localId
          ? { ...item, status: 'uploading', error: undefined }
          : item,
      ),
    );
    try {
      const resource = await client.uploadAttachment({
        filename: upload.filename,
        mediaType: upload.mediaType,
        bytes: upload.bytes,
      });
      if (!mounted.current) return;
      setAttachments((current) =>
        current.map((item) =>
          item.localId === upload.localId
            ? {
                ...item,
                status: 'ready',
                resource,
                bytes: undefined,
                error: undefined,
              }
            : item,
        ),
      );
    } catch (cause) {
      if (!mounted.current) return;
      setAttachments((current) =>
        current.map((item) =>
          item.localId === upload.localId
            ? {
                ...item,
                status: 'failed',
                error: errorMessage(cause, 'Upload failed.'),
              }
            : item,
        ),
      );
    }
  }

  async function addPickedAttachment(input: {
    uri: string;
    filename: string;
    declaredMediaType?: string;
  }): Promise<void> {
    const mediaType = attachmentMediaType(
      input.filename,
      input.declaredMediaType,
    );
    if (mediaType === undefined) {
      setError(`${input.filename} is not a supported attachment format.`);
      return;
    }
    const response = await expoFetch(input.uri);
    if (!response.ok) throw new Error(`Could not read ${input.filename}.`);
    const bytes = await response.arrayBuffer();
    const upload: AttachmentUpload = {
      localId: `attachment-local-${attachmentRequestKey()}`,
      filename: input.filename,
      mediaType,
      byteLength: bytes.byteLength,
      status: 'uploading',
      bytes,
      ...(mediaType.startsWith('image/') ? { previewUri: input.uri } : {}),
    };
    setAttachments((current) => [...current, upload]);
    await uploadAttachment(upload);
  }

  async function pickAttachments(): Promise<void> {
    if (attachmentPickerActive.current) return;
    attachmentPickerActive.current = true;
    setAttaching(true);
    setError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...SUPPORTED_ATTACHMENT_TYPES],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const available = Math.max(0, MAX_ATTACHMENTS - attachments.length);
      const selected = result.assets.slice(0, available);
      if (result.assets.length > available) {
        setError('Vera accepts at most five attachments per message.');
      }
      for (const asset of selected) {
        await addPickedAttachment({
          uri: asset.uri,
          filename: asset.name,
          ...(asset.mimeType === undefined
            ? {}
            : { declaredMediaType: asset.mimeType }),
        });
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Vera could not open the selected file.'));
    } finally {
      attachmentPickerActive.current = false;
      if (mounted.current) setAttaching(false);
    }
  }

  function reuseAttachment(reference: AttachmentReference): void {
    setAttachments((current) => {
      if (
        current.length >= MAX_ATTACHMENTS ||
        current.some((attachment) => attachment.resource?.id === reference.id)
      ) {
        return current;
      }
      return [
        ...current,
        {
          localId: `attachment-reuse-${reference.id}`,
          filename: reference.filename,
          mediaType: reference.mediaType,
          byteLength: reference.byteLength,
          status: 'ready',
          resource: reference,
          ...(reference.kind === 'image'
            ? { previewUri: client.attachmentPreviewUrl(reference.id) }
            : {}),
        },
      ];
    });
  }

  return {
    attachments,
    attaching,
    clearAttachments: () => setAttachments([]),
    pickAttachments,
    reuseAttachment,
    removeAttachment: (localId: string) =>
      setAttachments((current) =>
        current.filter((attachment) => attachment.localId !== localId),
      ),
    retryAttachment: (localId: string) => {
      const upload = attachments.find(
        (attachment) => attachment.localId === localId,
      );
      if (upload !== undefined) void uploadAttachment(upload);
    },
  };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
