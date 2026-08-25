import type {
  Scratchpad,
  ScratchpadProjection,
} from '../../../../ports/persistence/scratchpad.ts';

export class InMemoryScratchpad implements Scratchpad {
  private readonly projections = new Map<string, ScratchpadProjection>();

  public put(projection: ScratchpadProjection): Promise<void> {
    const existing = this.projections.get(projection.runId);
    if (
      existing === undefined ||
      projection.aggregateVersion > existing.aggregateVersion
    ) {
      this.projections.set(projection.runId, structuredClone(projection));
    }
    return Promise.resolve();
  }

  public get(runId: string): Promise<ScratchpadProjection | null> {
    const projection = this.projections.get(runId);
    return Promise.resolve(
      projection === undefined ? null : structuredClone(projection),
    );
  }

  public delete(runId: string): Promise<void> {
    this.projections.delete(runId);
    return Promise.resolve();
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}
