import { DPA_PROCESSOR_ENTITY_NAME } from 'src/engine/core-modules/dpa/config/dpa-region-config.constant';
import { DPA_TEMPLATE_VERSION } from 'src/engine/core-modules/dpa/constants/dpa-template-version.constant';
import { type DpaAgreementEntity } from 'src/engine/core-modules/dpa/entities/dpa-agreement.entity';
import { type DpaAgreementType } from 'src/engine/core-modules/dpa/enums/dpa-agreement-type.enum';
import { type DpaRegion } from 'src/engine/core-modules/dpa/types/dpa.type';

type BuildDpaAgreementRecordArgs = {
  workspaceId: string;
  type: DpaAgreementType;
  region: DpaRegion;
  acceptedAt: Date;
  acceptedByUserId?: string;
  acceptedByEmail?: string;
  customerLegalEntityName?: string;
  signatoryName?: string;
  signatoryTitle?: string;
  signedFileId?: string;
};

// Snapshots the Processor entity and template version at execution time so the record stays accurate if config/template change later.
export const buildDpaAgreementRecord = (
  args: BuildDpaAgreementRecordArgs,
): Partial<DpaAgreementEntity> => {
  return {
    workspaceId: args.workspaceId,
    type: args.type,
    templateVersion: DPA_TEMPLATE_VERSION,
    region: args.region,
    processorEntity: DPA_PROCESSOR_ENTITY_NAME,
    acceptedAt: args.acceptedAt,
    acceptedByUserId: args.acceptedByUserId,
    acceptedByEmail: args.acceptedByEmail,
    customerLegalEntityName: args.customerLegalEntityName,
    signatoryName: args.signatoryName,
    signatoryTitle: args.signatoryTitle,
    signedFileId: args.signedFileId,
  };
};
