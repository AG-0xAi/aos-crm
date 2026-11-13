import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { DpaAgreementEntity } from 'src/engine/core-modules/dpa/entities/dpa-agreement.entity';
import { DpaRegion } from 'src/engine/core-modules/dpa/enums/dpa-region.enum';
import { DpaRegionService } from 'src/engine/core-modules/dpa/services/dpa-region.service';
import { DpaService } from 'src/engine/core-modules/dpa/services/dpa.service';
import { FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';
import { FileUrlService } from 'src/engine/core-modules/file/file-url/file-url.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// @react-pdf/renderer is ESM-only and outside swc's transformIgnorePatterns allowlist;
// generateSignedDpa (the only caller) is not exercised by these tests.
jest.mock('src/engine/core-modules/dpa/pdf/render-dpa-to-pdf.util', () => ({
  renderDpaToPdfBuffer: jest.fn(),
}));

describe('DpaService', () => {
  let service: DpaService;
  let twentyConfigService: TwentyConfigService;

  const workspace = { id: 'workspace-id' } as Pick<WorkspaceEntity, 'id'>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DpaService,
        {
          provide: getRepositoryToken(DpaAgreementEntity),
          useValue: {},
        },
        {
          provide: DpaRegionService,
          useValue: {
            getRegionForWorkspace: jest.fn().mockReturnValue(DpaRegion.EU),
          },
        },
        {
          provide: FileStorageService,
          useValue: {},
        },
        {
          provide: FileUrlService,
          useValue: {},
        },
        {
          provide: ApplicationService,
          useValue: {},
        },
        {
          provide: TwentyConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DpaService>(DpaService);
    twentyConfigService = module.get<TwentyConfigService>(TwentyConfigService);
  });

  const setConfig = (config: {
    IS_DPA_GENERATOR_ENABLED?: boolean;
    DPA_PROCESSOR_ADDRESS?: string;
    DPA_PROCESSOR_CONTACT?: string;
    IS_MULTIWORKSPACE_ENABLED?: boolean;
  }) => {
    jest.spyOn(twentyConfigService, 'get').mockImplementation(((
      key: string,
    ) => {
      switch (key) {
        case 'IS_MULTIWORKSPACE_ENABLED':
          return config.IS_MULTIWORKSPACE_ENABLED ?? true;
        case 'IS_DPA_GENERATOR_ENABLED':
          return config.IS_DPA_GENERATOR_ENABLED;
        case 'DPA_PROCESSOR_ADDRESS':
          return config.DPA_PROCESSOR_ADDRESS;
        case 'DPA_PROCESSOR_CONTACT':
          return config.DPA_PROCESSOR_CONTACT;
        default:
          return undefined;
      }
    }) as TwentyConfigService['get']);
  };

  describe('getPreviewForWorkspace', () => {
    it('refuses when the DPA generator flag is off', () => {
      setConfig({
        IS_DPA_GENERATOR_ENABLED: false,
        DPA_PROCESSOR_ADDRESS: '123 Main St',
        DPA_PROCESSOR_CONTACT: 'dpo@example.com',
      });

      expect(() => service.getPreviewForWorkspace(workspace)).toThrow(
        BadRequestException,
      );
      expect(() => service.getPreviewForWorkspace(workspace)).toThrow(
        'The Data Processing Agreement generator is disabled for this deployment.',
      );
    });

    it('refuses when the flag is on but DPA_PROCESSOR_ADDRESS is empty', () => {
      setConfig({
        IS_DPA_GENERATOR_ENABLED: true,
        DPA_PROCESSOR_ADDRESS: '',
        DPA_PROCESSOR_CONTACT: 'dpo@example.com',
      });

      expect(() => service.getPreviewForWorkspace(workspace)).toThrow(
        BadRequestException,
      );
      expect(() => service.getPreviewForWorkspace(workspace)).toThrow(
        'DPA_PROCESSOR_ADDRESS and DPA_PROCESSOR_CONTACT must be configured before a Data Processing Agreement can be generated.',
      );
    });

    it('refuses when the flag is on but DPA_PROCESSOR_CONTACT is empty', () => {
      setConfig({
        IS_DPA_GENERATOR_ENABLED: true,
        DPA_PROCESSOR_ADDRESS: '123 Main St',
        DPA_PROCESSOR_CONTACT: '',
      });

      expect(() => service.getPreviewForWorkspace(workspace)).toThrow(
        BadRequestException,
      );
      expect(() => service.getPreviewForWorkspace(workspace)).toThrow(
        'DPA_PROCESSOR_ADDRESS and DPA_PROCESSOR_CONTACT must be configured before a Data Processing Agreement can be generated.',
      );
    });

    it('generates the document naming AOS Holding as Processor when the flag is on and both values are set', () => {
      setConfig({
        IS_DPA_GENERATOR_ENABLED: true,
        DPA_PROCESSOR_ADDRESS: '123 Main St',
        DPA_PROCESSOR_CONTACT: 'dpo@example.com',
      });

      const document = service.getPreviewForWorkspace(workspace);

      expect(document.processorEntity).toBe('AOS Holding');
    });
  });
});
