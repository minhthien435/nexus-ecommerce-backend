import { describe, expect, it, vi } from 'vitest';
import { KaggleImportService } from './kaggle-import.service.js';

const fixture = 'test/fixtures/kaggle/amazon-sales.csv';
const mapping = 'test/fixtures/kaggle/category-mapping.json';

describe('KaggleImportService', () => {
  it('uses inspect only during dry-run and performs no upsert', async () => {
    const products = {
      inspect: vi.fn().mockResolvedValue('created'),
      upsert: vi.fn(),
    };
    const service = new KaggleImportService(products as never, {} as never);
    const report = await service.run({
      file: fixture,
      mappingFile: mapping,
      datasetName: 'amazon',
      sellerId: 'seller',
      dryRun: true,
    });
    expect(report.productsCreated).toBe(1);
    expect(products.inspect).toHaveBeenCalledOnce();
    expect(products.upsert).not.toHaveBeenCalled();
  });

  it('imports the valid row while reporting and skipping the invalid row', async () => {
    const products = {
      inspect: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ action: 'created' }),
    };
    const service = new KaggleImportService(products as never, {} as never);
    const report = await service.run({
      file: fixture,
      mappingFile: mapping,
      datasetName: 'amazon',
      sellerId: 'seller',
      batchSize: 1,
    });
    expect(products.upsert).toHaveBeenCalledOnce();
    expect(report).toMatchObject({
      totalRows: 2,
      validRows: 1,
      productsCreated: 1,
      skipped: 1,
      failed: 0,
    });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, errorCode: 'CATEGORY_NOT_MAPPED' }),
        expect.objectContaining({ row: 3, errorCode: 'INVALID_PRICE' }),
      ]),
    );
  });

  it('reports repeat upsert outcomes without claiming another creation', async () => {
    const products = {
      inspect: vi.fn(),
      upsert: vi
        .fn()
        .mockResolvedValueOnce({ action: 'created' })
        .mockResolvedValueOnce({ action: 'unchanged' }),
    };
    const service = new KaggleImportService(products as never, {} as never);
    const options = {
      file: fixture,
      mappingFile: mapping,
      datasetName: 'amazon',
      sellerId: 'seller',
    };
    const first = await service.run(options);
    const repeat = await service.run(options);
    expect(first.productsCreated).toBe(1);
    expect(repeat).toMatchObject({ productsCreated: 0, productsUnchanged: 1 });
    expect(products.upsert).toHaveBeenCalledTimes(2);
  });

  it('validates canonical JSON instead of bypassing validation', async () => {
    const service = new KaggleImportService({} as never, {} as never);
    const result = await service.transform(
      'test/fixtures/kaggle/canonical-invalid.json',
      'amazon',
      mapping,
    );
    expect(result.products).toHaveLength(0);
    expect(result.issues.map((issue) => issue.errorCode)).toEqual(
      expect.arrayContaining([
        'REQUIRED',
        'INVALID_ATTRIBUTES',
        'INVALID_PRICE',
        'INVALID_CURRENCY',
        'INVALID_URL',
      ]),
    );
  });

  it('attributes an import failure to the normalized source row', async () => {
    const products = {
      inspect: vi.fn(),
      upsert: vi.fn().mockRejectedValue(new Error('write failed')),
    };
    const service = new KaggleImportService(products as never, {} as never);
    const report = await service.run({
      file: fixture,
      mappingFile: mapping,
      datasetName: 'amazon',
      sellerId: 'seller',
    });
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        externalId: 'P-001',
        errorCode: 'IMPORT_FAILED',
      }),
    );
  });
});
