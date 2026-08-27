import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ArtifactResource,
  ChangeApplicationResource,
  SoftwareChangePublicationResource,
  VeraApi,
} from '@vera/client';

import {
  selectDeliveryApplication,
  selectDeliveryPublication,
  type PublicationDraft,
} from './model';

type SoftwareChangeArtifact = Extract<
  ArtifactResource,
  { type: 'software_change' }
>;

export type SoftwareDeliveryState = {
  artifact?: SoftwareChangeArtifact;
  application?: ChangeApplicationResource;
  publication?: SoftwareChangePublicationResource;
  loading: boolean;
  busy?:
    | 'prepare_application'
    | 'decide_application'
    | 'cancel_application'
    | 'prepare_publication'
    | 'decide_publication'
    | 'cancel_publication';
  error?: string;
};

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : fallback;
}

function deliveryKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useSoftwareDelivery(client: VeraApi, artifactId: string) {
  const [state, setState] = useState<SoftwareDeliveryState>({ loading: true });
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const applicationFollower = useRef<AbortController | undefined>(undefined);
  const publicationFollower = useRef<AbortController | undefined>(undefined);
  const busyRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      applicationFollower.current?.abort();
      publicationFollower.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const [artifact, applicationPage] = await Promise.all([
        client.getArtifact(artifactId),
        client.listChangeApplicationsForArtifact(artifactId),
      ]);
      if (artifact.type !== 'software_change') {
        throw new Error('This delivery does not reference a software change.');
      }
      const application = selectDeliveryApplication(
        applicationPage.applications,
      );
      const publicationPage =
        application?.status === 'succeeded'
          ? await client.listSoftwareChangePublicationsForApplication(
              application.id,
            )
          : undefined;
      if (!mounted.current || generation !== loadGeneration.current) return;
      setState({
        artifact,
        ...(application === undefined ? {} : { application }),
        ...(publicationPage === undefined
          ? {}
          : {
              publication: selectDeliveryPublication(
                publicationPage.publications,
              ),
            }),
        loading: false,
      });
    } catch (cause) {
      if (!mounted.current || generation !== loadGeneration.current) return;
      setState((current) => ({
        ...current,
        loading: false,
        error: message(cause, 'Vera could not load this delivery.'),
      }));
    }
  }, [artifactId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  const followApplication = useCallback(
    (application: ChangeApplicationResource) => {
      if (
        !['approved', 'applying', 'cancellation_requested'].includes(
          application.status,
        )
      )
        return;
      applicationFollower.current?.abort();
      const controller = new AbortController();
      applicationFollower.current = controller;
      void client
        .waitForChangeApplication(application.id, {
          signal: controller.signal,
          onUpdate: (update) => {
            if (mounted.current)
              setState((current) => ({ ...current, application: update }));
          },
        })
        .then(async (completed) => {
          if (!mounted.current || controller.signal.aborted) return;
          setState((current) => ({ ...current, application: completed }));
          if (completed.status === 'succeeded') await load();
        })
        .catch((cause: unknown) => {
          if (!mounted.current || controller.signal.aborted) return;
          setState((current) => ({
            ...current,
            error: message(cause, 'Application progress could not be loaded.'),
          }));
        });
    },
    [client, load],
  );

  const followPublication = useCallback(
    (publication: SoftwareChangePublicationResource) => {
      if (!['approved', 'publishing'].includes(publication.status)) return;
      publicationFollower.current?.abort();
      const controller = new AbortController();
      publicationFollower.current = controller;
      void client
        .waitForSoftwareChangePublication(publication.id, {
          signal: controller.signal,
          onUpdate: (update) => {
            if (mounted.current)
              setState((current) => ({ ...current, publication: update }));
          },
        })
        .then((completed) => {
          if (!mounted.current || controller.signal.aborted) return;
          setState((current) => ({ ...current, publication: completed }));
        })
        .catch((cause: unknown) => {
          if (!mounted.current || controller.signal.aborted) return;
          setState((current) => ({
            ...current,
            error: message(cause, 'Publication progress could not be loaded.'),
          }));
        });
    },
    [client],
  );

  useEffect(() => {
    if (state.application !== undefined) followApplication(state.application);
  }, [followApplication, state.application?.id, state.application?.status]);

  useEffect(() => {
    if (state.publication !== undefined) followPublication(state.publication);
  }, [followPublication, state.publication?.id, state.publication?.status]);

  const perform = useCallback(
    async <T>(
      busy: NonNullable<SoftwareDeliveryState['busy']>,
      operation: () => Promise<T>,
      apply: (value: T) => void,
      fallback: string,
    ) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setState((current) => ({ ...current, busy, error: undefined }));
      try {
        const value = await operation();
        if (mounted.current) apply(value);
      } catch (cause) {
        if (mounted.current)
          setState((current) => ({
            ...current,
            error: message(cause, fallback),
          }));
      } finally {
        busyRef.current = false;
        if (mounted.current)
          setState((current) => ({ ...current, busy: undefined }));
      }
    },
    [],
  );

  return {
    state,
    refresh: load,
    prepareApplication: () =>
      perform(
        'prepare_application',
        () =>
          client.createChangeApplication({
            artifactId,
            idempotencyKey: deliveryKey('frontend-application'),
          }),
        (application) =>
          setState((current) => ({
            ...current,
            application,
            publication: undefined,
          })),
        'Vera could not prepare the staging review.',
      ),
    decideApplication: (decision: 'approved' | 'rejected') => {
      const application = state.application;
      if (application === undefined) return Promise.resolve();
      return perform(
        'decide_application',
        () =>
          client.decideChangeApplication({
            applicationId: application.id,
            decision,
          }),
        (decided) => {
          setState((current) => ({ ...current, application: decided }));
          followApplication(decided);
        },
        'Vera could not record the staging decision.',
      );
    },
    cancelApplication: () => {
      const application = state.application;
      if (application === undefined) return Promise.resolve();
      return perform(
        'cancel_application',
        () => client.cancelChangeApplication(application.id),
        (cancelled) => {
          setState((current) => ({ ...current, application: cancelled }));
          followApplication(cancelled);
        },
        'Vera could not cancel the staging operation.',
      );
    },
    preparePublication: (draft: PublicationDraft) => {
      const application = state.application;
      if (application?.status !== 'succeeded') return Promise.resolve();
      return perform(
        'prepare_publication',
        () =>
          client.createSoftwareChangePublication({
            applicationId: application.id,
            baseBranch: draft.baseBranch.trim(),
            commitMessage: draft.commitMessage.trim(),
            pullRequest: {
              title: draft.pullRequestTitle.trim(),
              body: draft.pullRequestBody,
              draft: draft.draft,
            },
            idempotencyKey: deliveryKey('frontend-publication'),
          }),
        (publication) => setState((current) => ({ ...current, publication })),
        'Vera could not prepare the pull-request review.',
      );
    },
    decidePublication: (decision: 'approved' | 'rejected') => {
      const publication = state.publication;
      if (publication === undefined) return Promise.resolve();
      return perform(
        'decide_publication',
        () =>
          client.decideSoftwareChangePublication({
            publicationId: publication.id,
            decision,
          }),
        (decided) => {
          setState((current) => ({ ...current, publication: decided }));
          followPublication(decided);
        },
        'Vera could not record the publication decision.',
      );
    },
    cancelPublication: () => {
      const publication = state.publication;
      if (publication === undefined) return Promise.resolve();
      return perform(
        'cancel_publication',
        () => client.cancelSoftwareChangePublication(publication.id),
        (cancelled) =>
          setState((current) => ({ ...current, publication: cancelled })),
        'Vera could not cancel the publication.',
      );
    },
  };
}
