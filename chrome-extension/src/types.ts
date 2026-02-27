export interface PageMetadata {
  readonly title: string | null;
  readonly byline: string | null;
  readonly excerpt: string | null;
  readonly siteName: string | null;
  readonly publishedTime: string | null;
  readonly lang: string | null;
}

export interface ExtractResult {
  readonly content: string;
  readonly metadata: PageMetadata;
}

export interface ConvertResult {
  readonly markdown: string;
  readonly metadata: PageMetadata;
}
