import { fetchPage } from "./fetcher.js";
import { extractContent, isProbablyReaderable } from "./extractor.js";
import { extractMdx } from "./mdx-extractor.js";
import { htmlToMarkdown } from "./converter.js";
import { ValidationError } from "./errors.js";
import type { ConvertOptions, ConvertResult, PageMetadata } from "./types.js";

export type { ConvertOptions, ConvertResult, PageMetadata };
export { fetchPage, validateUrl } from "./fetcher.js";
export { extractContent } from "./extractor.js";
export { extractMdx } from "./mdx-extractor.js";
export { htmlToMarkdown } from "./converter.js";
export {
  MarkitdownError,
  ValidationError,
  SSRFError,
  NetworkError,
  ContentError,
} from "./errors.js";

const DEFAULT_OPTIONS: Readonly<ConvertOptions> = Object.freeze({
  browser: false,
  raw: false,
  frontmatter: false,
  noImages: false,
  timeout: 30_000,
});

/**
 * Sanitize a metadata string for safe YAML embedding.
 * Escapes double quotes, strips newlines and control characters.
 */
function sanitizeYamlValue(value: string): string {
  const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g; // eslint-disable-line no-control-regex
  return value
    .replace(/\\/g, "\\\\")                    // escape backslashes first
    .replace(/"/g, '\\"')                       // escape double quotes
    .replace(/[\r\n\u0085\u2028\u2029]+/g, " ") // collapse all line breaks (including Unicode)
    .replace(CONTROL_CHARS_RE, "")              // strip all ASCII control chars (tabs, etc.)
    .trim();
}

function generateFrontmatter(
  metadata: PageMetadata,
  sourceUrl: string
): string {
  const lines: string[] = ["---"];

  if (metadata.title)
    lines.push(`title: "${sanitizeYamlValue(metadata.title)}"`);
  if (metadata.byline)
    lines.push(`author: "${sanitizeYamlValue(metadata.byline)}"`);
  if (metadata.publishedTime)
    lines.push(`date: "${sanitizeYamlValue(metadata.publishedTime)}"`);
  if (metadata.excerpt)
    lines.push(`description: "${sanitizeYamlValue(metadata.excerpt)}"`);
  if (metadata.siteName)
    lines.push(`site: "${sanitizeYamlValue(metadata.siteName)}"`);
  if (metadata.lang)
    lines.push(`lang: "${sanitizeYamlValue(metadata.lang)}"`);
  lines.push(`source: "${sanitizeYamlValue(sourceUrl)}"`);
  lines.push("---");

  return lines.join("\n");
}

/**
 * Convert a URL to Markdown.
 *
 * Primary API for both CLI and programmatic use.
 * Fetches the page, extracts main content via Readability,
 * converts to Markdown, and optionally prepends YAML frontmatter.
 *
 * @param url - The HTTP/HTTPS URL to convert.
 * @param options - Override default conversion options.
 * @returns The Markdown string, page metadata, and any warnings.
 * @throws {ValidationError} If the URL or options are invalid.
 * @throws {SSRFError} If the URL targets a private/internal host.
 * @throws {NetworkError} On timeout, DNS failure, or HTTP error.
 * @throws {ContentError} If the response is too large or malformed.
 *
 * @example
 * ```ts
 * import { convert, NetworkError } from "web-to-markdown";
 *
 * try {
 *   const { markdown } = await convert("https://example.com");
 * } catch (err) {
 *   if (err instanceof NetworkError) console.error("Network issue:", err.message);
 * }
 * ```
 */
export async function convert(
  url: string,
  options: Partial<ConvertOptions> = {}
): Promise<ConvertResult> {
  // ── Input validation at the API boundary ──────────────────────────────
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new ValidationError("A non-empty URL string is required.");
  }
  if (options !== null && typeof options !== "object") {
    throw new ValidationError("Options must be an object.");
  }

  const opts: ConvertOptions = { ...DEFAULT_OPTIONS, ...options };

  // URL validation and SSRF protection are handled inside fetchPage()

  // Fetch
  const { html, finalUrl } = await fetchPage(url, {
    browser: opts.browser,
    timeout: opts.timeout,
  });

  let metadata: PageMetadata = {
    title: null,
    byline: null,
    excerpt: null,
    siteName: null,
    publishedTime: null,
    lang: null,
  };

  const warnings: string[] = [];
  let markdown: string;

  // Try to extract raw MDX from Next.js RSC payloads first — this gives
  // complete content including collapsed accordions, tabs, etc.
  const mdxResult = !opts.raw ? extractMdx(html, finalUrl) : null;

  if (mdxResult) {
    markdown = mdxResult.markdown;
    metadata = mdxResult.metadata;

    if (opts.noImages) {
      markdown = markdown.replace(/!\[[^\]]*\]\([^)]*\)\s*/g, "");
    }
  } else {
    // Standard path: extract content from HTML, then convert to markdown
    let contentHtml: string;

    if (opts.raw) {
      contentHtml = html;
    } else {
      const extracted = extractContent(html, finalUrl);

      if (!extracted) {
        if (!opts.browser && !isProbablyReaderable(html)) {
          warnings.push(
            "Content extraction returned empty results. " +
              "This page may require JavaScript rendering. " +
              "Try re-running with --browser flag."
          );
        }
        contentHtml = html;
      } else {
        contentHtml = extracted.content;
        metadata = extracted.metadata;
      }
    }

    markdown = htmlToMarkdown(contentHtml, {
      baseUrl: finalUrl,
      stripImages: opts.noImages,
    });
  }

  // Prepend frontmatter if requested
  if (opts.frontmatter) {
    const fm = generateFrontmatter(metadata, finalUrl);
    markdown = fm + "\n\n" + markdown;
  }

  return { markdown, metadata, warnings };
}
