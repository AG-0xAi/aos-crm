import { Test, type TestingModule } from '@nestjs/testing';

import { AdminPanelVersionService } from 'src/engine/core-modules/admin-panel/services/admin-panel-version.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

describe('AdminPanelVersionService', () => {
  let service: AdminPanelVersionService;
  let twentyConfigService: jest.Mocked<TwentyConfigService>;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    twentyConfigService = {
      get: jest.fn().mockReturnValue('0.1.0-beta.abc123'),
    } as any;

    fetchSpy = jest.spyOn(global, 'fetch');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPanelVersionService,
        {
          provide: TwentyConfigService,
          useValue: twentyConfigService,
        },
      ],
    }).compile();

    service = module.get<AdminPanelVersionService>(AdminPanelVersionService);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns the current version without calling out to Docker Hub', async () => {
    const result = await service.getVersionInfo();

    expect(result).toEqual({
      currentVersion: '0.1.0-beta.abc123',
      latestVersion: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
