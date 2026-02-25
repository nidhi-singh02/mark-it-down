import { fetchPage } from "./fetcher.js";
import { extractContent, isProbablyReaderable } from "./extractor.js";
import { htmlToMarkdown } from "./converter.js";
import type { ConvertOptions, ConvertResult, PageMetadata } from "./types.js";

export type { ConvertOptions, ConvertResult, PageMetadata };
export { fetchPage, validateUrl } from "./fetcher.js";
export { extractContent } from "./extractor.js";
export { htmlToMarkdown } from "./converter.js";

const DEFAULT_OPTIONS: ConvertOptions = {
  browser: false,
  raw: false,
  frontmatter: false,
  noImages: false,
  timeout: 30_000,
};

/**
 * Sanitize a metadata string for safe YAML embedding.
 * Escapes double quotes, strips newlines and control characters.
 */
function sanitizeYamlValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")                    // escape backslashes first
    .replace(/"/g, '\\"')                       // escape double quotes
    .replace(/[\r\n\u0085\u2028\u2029]+/g, " ") // collapse all line breaks (including Unicode)
    .replace(/[\x00-\x1f\x7f]/g, "")            // strip all ASCII control chars (tabs, etc.)
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
 */
export async function convert(
  url: string,
  options: Partial<ConvertOptions> = {}
): Promise<ConvertResult> {
  const opts: ConvertOptions = { ...DEFAULT_OPTIONS, ...options };

  // URL validation and SSRF protection are handled inside fetchPage()

  // Fetch
  const { html, finalUrl } = await fetchPage(url, {
    browser: opts.browser,
    timeout: opts.timeout,
  });

  // Extract or use raw HTML
  let contentHtml: string;
  let metadata: PageMetadata = {
    title: null,
    byline: null,
    excerpt: null,
    siteName: null,
    publishedTime: null,
    lang: null,
  };

  if (opts.raw) {
    contentHtml = html;
  } else {
    const extracted = extractContent(html, finalUrl);

    if (!extracted) {
      if (!opts.browser && !isProbablyReaderable(html)) {
        process.stderr.write(
          "Warning: Content extraction returned empty results.\n" +
            "This page may require JavaScript rendering.\n" +
            "Try re-running with --browser flag.\n\n"
        );
      }
      contentHtml = html;
    } else {
      contentHtml = extracted.content;
      metadata = extracted.metadata;
    }
  }

  // Convert to Markdown
  let markdown = htmlToMarkdown(contentHtml, {
    baseUrl: finalUrl,
    stripImages: opts.noImages,
  });

  // Prepend frontmatter if requested
  if (opts.frontmatter) {
    const fm = generateFrontmatter(metadata, finalUrl);
    markdown = fm + "\n\n" + markdown;
  }

  return { markdown, metadata };
}
