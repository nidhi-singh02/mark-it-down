export interface ConvertOptions {
  /** Force headless browser rendering (for SPAs). */
  browser: boolean;
  /** Convert full HTML without content extraction. */
  raw: boolean;
  /** Include YAML frontmatter with metadata. */
  frontmatter: boolean;
  /** Strip images from output. */
  noImages: boolean;
  /** Timeout in milliseconds for page loading. */
  timeout: number;
  /** Output file path (undefined means stdout). */
  output?: string;
}

export interface FetchResult {
  /** The raw HTML string of the page. */
  html: string;
  /** The final URL after any redirects. */
  finalUrl: string;
}

export interface PageMetadata {
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  siteName: string | null;
  publishedTime: string | null;
  lang: string | null;
}

export interface ExtractResult {
  /** Cleaned HTML content (article body). */
  content: string;
  /** Metadata about the page. */
  metadata: PageMetadata;
}

export interface ConvertResult {
  /** The Markdown output string. */
  markdown: string;
  /** Metadata extracted from the page. */
  metadata: PageMetadata;
  /** Non-fatal warnings generated during conversion. */
  warnings: string[];
}
