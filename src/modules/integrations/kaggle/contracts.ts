export interface ImportedSku {
  externalId: string;
  attributes: Record<string, string>;
  price: string;
  currency: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}
export interface ImportedImage {
  externalId: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}
export interface ImportedProduct {
  sourceRow?: number;
  sourceSystem: 'KAGGLE';
  datasetName: string;
  externalId: string;
  name: string;
  categoryName: string;
  categorySlug?: string;
  brand: string | null;
  description: string | null;
  isAuctionEligible: boolean;
  attributes: Record<string, unknown>;
  skus: ImportedSku[];
  images: ImportedImage[];
}
export interface ImportIssue {
  row: number;
  externalId?: string;
  path: string;
  errorCode: string;
  message: string;
}
export interface ImportReport {
  datasetName: string;
  startedAt: string;
  finishedAt: string;
  totalRows: number;
  validRows: number;
  productsCreated: number;
  productsUpdated: number;
  productsUnchanged: number;
  skipped: number;
  failed: number;
  auctionsCreated: number;
  issues: ImportIssue[];
}
