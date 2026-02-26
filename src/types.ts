export interface ConvertOptions {
  /** Force headless browser rendering (for SPAs). */
  readonly browser: boolean;
  /** Convert full HTML without content extraction. */
  readonly raw: boolean;
  /** Include YAML frontmatter with metadata. */
  readonly frontmatter: boolean;
  /** Strip images from output. */
  readonly noImages: boolean;
  /** Timeout in milliseconds for page loading. */
  readonly timeout: number;
  /** Output file path (undefined means stdout). */
  readonly output?: string;
}

export interface FetchResult {
  /** The raw HTML string of the page. */
  readonly html: string;
  /** The final URL after any redirects. */
  readonly finalUrl: string;
}

export interface PageMetadata {
  readonly title: string | null;
  readonly byline: string | null;
  readonly excerpt: string | null;
  readonly siteName: string | null;
  readonly publishedTime: string | null;
  readonly lang: string | null;
}

export interface ExtractResult {
  /** Cleaned HTML content (article body). */
  readonly content: string;
  /** Metadata about the page. */
  readonly metadata: PageMetadata;
}

export interface ConvertResult {
  /** The Markdown output string. */
  readonly markdown: string;
  /** Metadata extracted from the page. */
  readonly metadata: PageMetadata;
  /** Non-fatal warnings generated during conversion. */
  readonly warnings: readonly string[];
}
