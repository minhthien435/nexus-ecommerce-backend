import { NestFactory } from '@nestjs/core';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppModule } from '../src/app.module.js';
import { KaggleImportService } from '../src/modules/integrations/kaggle/kaggle-import.service.js';

const args = process.argv.slice(2);
const command = args.shift() ?? 'dry-run';
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
const flag = (name: string) => args.includes(`--${name}`);
const required = (name: string) => {
  const value = option(name);
  if (!value) throw new Error(`Thiếu --${name}`);
  return value;
};
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const service = app.get(KaggleImportService);
    const datasetName = option('dataset-name') ?? 'karkavelraja-amazon-sales';
    const mappingFile =
      option('mapping') ?? 'data/kaggle/category-mapping.json';
    if (command === 'generate-auctions') {
      const ids = required('sku-ids').split(',').filter(Boolean);
      const defaultStart = Date.now() + 60 * 60 * 1000;
      const count = await service.generateAuctions(
        ids,
        Number(option('percentage') ?? 20),
        new Date(option('starts-at') ?? defaultStart),
      );
      console.log(JSON.stringify({ auctionsCreated: count }));
      return;
    }
    const file = required('file');
    if (command === 'inspect' || command === 'transform') {
      const result = await service.transform(file, datasetName, mappingFile);
      if (command === 'transform') {
        const output = required('output');
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify(result.products, null, 2));
      }
      console.log(
        JSON.stringify(
          {
            totalRows: result.totalRows,
            validRows: result.products.length,
            issues: result.issues,
          },
          null,
          2,
        ),
      );
      return;
    }
    const report = await service.run({
      file,
      datasetName,
      mappingFile,
      sellerId: required('seller-id'),
      dryRun: command === 'dry-run' || flag('dry-run'),
      limit: option('limit') ? Number(option('limit')) : undefined,
      batchSize: Number(option('batch-size') ?? 100),
      checkpointFile: option('checkpoint'),
      reportFile: option('report'),
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
