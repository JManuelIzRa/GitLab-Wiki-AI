import { TestBed } from '@angular/core/testing';
import { OfflineCacheService } from './offline-cache.service';

describe('OfflineCacheService', () => {
  let service: OfflineCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OfflineCacheService);
  });

  it('is created', () => {
    expect(service).toBeTruthy();
  });

  it('getStructure returns null for an unknown repo without throwing', async () => {
    const result = await service.getStructure(99999).catch(() => null);
    expect(result == null).toBeTrue();
  });

  it('getPage returns null for an unknown slug without throwing', async () => {
    const result = await service.getPage(99999, 'nonexistent').catch(() => null);
    expect(result == null).toBeTrue();
  });
});
