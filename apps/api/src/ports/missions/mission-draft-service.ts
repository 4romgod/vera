import type {
  Mission,
  MissionProposalArguments,
} from '../../domain/missions/mission.ts';

export type MissionDraftService = {
  createFromProposal(input: {
    principalId: string;
    requestKey: string;
    proposal: MissionProposalArguments;
    source?: Mission['source'];
  }): Promise<Mission>;
};

export type MissionDraftServiceReference = { current?: MissionDraftService };
