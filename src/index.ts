import { fetchPage, fetchRawText } from "./fetcher.js";
import { extractContent, isProbablyReaderable } from "./extractor.js";
import { extractMdx, processRawMdx } from "./mdx-extractor.js";
import { htmlToMarkdown } from "./converter.js";
import { ValidationError } from "./errors.js";
import type { ConvertOptions, ConvertResult, PageMetadata } from "./types.js";

export type { ConvertOptions, ConvertResult, PageMetadata };
export { fetchPage, validateUrl, fetchRawText } from "./fetcher.js";
export { extractContent } from "./extractor.js";
export { extractMdx, processRawMdx } from "./mdx-extractor.js";
export { htmlToMarkdown } from "./converter.js";
export {
  MarkitdownError,
  ValidationError,
  SSRFError,
  NetworkError,
  ContentError,
} from "./errors.js";

// ─── Markdown URL Strategy ────────────────────────────────────────────────────

/** Build a .md URL from a page URL (strips trailing slash, appends .md). */
function buildMarkdownUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    // Strip trailing slash
    if (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    // Skip root paths and paths that already have a file extension
    if (!pathname || pathname === "/") return null;
    if (/\.\w+$/.test(pathname)) return null;
    parsed.pathname = pathname + ".md";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Check if a response body looks like markdown (not HTML). */
function isLikelyMarkdown(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.length < 50) return false;
  // Reject HTML documents
  if (/^<!doctype\s/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return false;
  // Reject responses with many HTML tags (likely an HTML error page)
  const tagCount = (trimmed.slice(0, 2000).match(/<[a-z]+[\s>]/gi) || []).length;
  if (tagCount > 10) return false;
  return true;
}

/**
 * Try to fetch raw markdown from the .md endpoint of a URL.
 * Many documentation sites (Mintlify, GitBook, Next.js docs, etc.)
 * serve raw markdown when .md is appended to the URL path.
 */
async function tryFetchMarkdownSource(
  url: string,
  timeout: number
): Promise<{ markdown: string; metadata: PageMetadata } | null> {
  const mdUrl = buildMarkdownUrl(url);
  if (!mdUrl) return null;

  const result = await fetchRawText(mdUrl, timeout);
  if (!result) return null;
  if (!isLikelyMarkdown(result.body)) return null;

  return processRawMdx(result.body, url);
}

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
    .replace(/\\/g, "\\\\") // escape backslashes first
    .replace(/"/g, '\\"') // escape double quotes
    .replace(/[\r\n\u0085\u2028\u2029]+/g, " ") // collapse all line breaks (including Unicode)
    .replace(CONTROL_CHARS_RE, "") // strip all ASCII control chars (tabs, etc.)
    .trim();
}

function generateFrontmatter(metadata: PageMetadata, sourceUrl: string): string {
  const lines: string[] = ["---"];

  if (metadata.title) lines.push(`title: "${sanitizeYamlValue(metadata.title)}"`);
  if (metadata.byline) lines.push(`author: "${sanitizeYamlValue(metadata.byline)}"`);
  if (metadata.publishedTime) lines.push(`date: "${sanitizeYamlValue(metadata.publishedTime)}"`);
  if (metadata.excerpt) lines.push(`description: "${sanitizeYamlValue(metadata.excerpt)}"`);
  if (metadata.siteName) lines.push(`site: "${sanitizeYamlValue(metadata.siteName)}"`);
  if (metadata.lang) lines.push(`lang: "${sanitizeYamlValue(metadata.lang)}"`);
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

  const warnings: string[] = [];

  // ── Strategy 0: Try .md endpoint ────────────────────────────────────────
  // Many doc sites (Mintlify, GitBook, Next.js docs, etc.) serve raw
  // markdown when .md is appended to the URL path. This is the most
  // reliable source — it includes all content without rendering artifacts.
  if (!opts.raw) {
    const mdSource = await tryFetchMarkdownSource(url, opts.timeout);
    if (mdSource) {
      let { markdown } = mdSource;
      const { metadata } = mdSource;

      if (opts.noImages) {
        markdown = markdown.replace(/!\[[^\]]*\]\([^)]*\)\s*/g, "");
      }
      if (opts.frontmatter) {
        const fm = generateFrontmatter(metadata, url);
        markdown = fm + "\n\n" + markdown;
      }

      return { markdown, metadata, warnings };
    }
  }

  // ── Fetch the HTML page ─────────────────────────────────────────────────
  // URL validation and SSRF protection are handled inside fetchPage()
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

  let markdown: string;

  // ── Strategy 1–2: Extract MDX from RSC payloads ─────────────────────────
  const mdxResult = !opts.raw ? extractMdx(html, finalUrl) : null;

  if (mdxResult) {
    markdown = mdxResult.markdown;
    metadata = mdxResult.metadata;

    if (opts.noImages) {
      markdown = markdown.replace(/!\[[^\]]*\]\([^)]*\)\s*/g, "");
    }
  } else {
    // ── Strategy 3: Readability + HTML-to-Markdown ──────────────────────
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
