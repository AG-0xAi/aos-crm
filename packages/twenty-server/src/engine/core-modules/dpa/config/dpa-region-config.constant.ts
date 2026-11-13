import { DpaRegion } from 'src/engine/core-modules/dpa/enums/dpa-region.enum';
import { type DpaRegionConfig } from 'src/engine/core-modules/dpa/types/dpa.type';

export const DEFAULT_DPA_REGION: DpaRegion = DpaRegion.EU;

// Processor name is fixed; address and privacy contact come from deployment
// config (DPA_PROCESSOR_ADDRESS / DPA_PROCESSOR_CONTACT) with empty defaults —
// the generator refuses to run while they are unset. The rest of this DPA
// template (EU Affiliate, governing law, and prose outside these merge
// fields) is still Twenty's and needs lawyer review before this is used for
// AOS Holding. See docs/aos/product/BETA_RUNBOOK.md.
export const DPA_PROCESSOR_ENTITY_NAME = 'AOS Holding';

const buildDpaCommonValues = (
  processorAddress: string,
  processorContact: string,
) => ({
  PROCESSOR_ENTITY: DPA_PROCESSOR_ENTITY_NAME,
  PROCESSOR_LEGAL_FORM:
    'a public benefit corporation under the laws of Delaware, USA',
  PROCESSOR_ADDRESS: processorAddress,
  EU_AFFILIATE_ENTITY: 'Twenty.com SAS',
  EU_AFFILIATE_LEGAL_FORM:
    'a société par actions simplifiée under the laws of France',
  EU_AFFILIATE_ADDRESS: '9 Rue des Colonnes, 75002 Paris, France',
  GOVERNING_LAW: 'the State of Delaware, USA',
  DPO_NAME_AND_CONTACT: processorContact,
});

export const TWENTY_PRESIGNED_SIGNATORY = {
  name: 'Félix Malfait',
  title: 'Chief Executive Officer',
};

export const getDpaRegionConfig = (
  region: DpaRegion,
  processorAddress: string,
  processorContact: string,
): DpaRegionConfig => {
  const resolvedRegion =
    region === DpaRegion.US ? DpaRegion.US : DEFAULT_DPA_REGION;
  const values = buildDpaCommonValues(processorAddress, processorContact);

  return {
    region: resolvedRegion,
    sccSectionActive: true,
    values: {
      ...values,
      HOSTING_REGION:
        resolvedRegion === DpaRegion.US
          ? 'United States'
          : 'EU (Frankfurt, Germany)',
    },
  };
};
