export class UploadedMediaDto {
  url: string;
  key: string;
  size: number;
  mimetype: string;
}

export class UploadMultipleMediaDto {
  urls: string[];
  files: UploadedMediaDto[];
}
