import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractResult, PageMetadata } from "./types.js";

/**
 * Extract the main article content from raw HTML using
 * Mozilla Readability + linkedom DOM parsing.
 *
 * @param html - The raw HTML string to process.
 * @param url - The page URL, used for resolving relative links.
 * @returns The extracted content and metadata, or `null` if extraction fails.
 */
export function extractContent(
  html: string,
  url: string
): ExtractResult | null {
  let document: ReturnType<typeof parseHTML>["document"];
  try {
    ({ document } = parseHTML(html));
  } catch (err: unknown) {
    // Catch stack overflow from deeply nested / malformed HTML
    if (err instanceof RangeError) return null;
    throw err;
  }

  // Inject base URL so Readability resolves relative links
  const baseElement = document.createElement("base");
  baseElement.setAttribute("href", url);
  document.head.appendChild(baseElement);

  // linkedom's Document implements the DOM API that Readability expects
  const reader = new Readability(document as unknown as Document, {
    charThreshold: 100,
    maxElemsToParse: 100_000, // Limit DOM elements to prevent resource exhaustion
  });

  let article: ReturnType<typeof reader.parse>;
  try {
    article = reader.parse();
  } catch (err: unknown) {
    if (err instanceof RangeError) return null;
    throw err;
  }

  if (!article || !article.content) {
    return fallbackExtract(html);
  }

  // Detect when Readability drops significant content (e.g. code blocks on
  // documentation sites). Compare <pre> counts as a proxy: if the raw HTML
  // has <pre> blocks but Readability's output has none, fall back to
  // extracting from <article> or <main> which preserves them.
  // Note: Readability mutates the DOM, so fallback must re-parse the HTML.
  const rawPreCount = (html.match(/<pre[\s>]/gi) || []).length;
  const extractedPreCount = (article.content.match(/<pre[\s>]/gi) || []).length;

  if (rawPreCount > 0 && extractedPreCount === 0) {
    const fallback = fallbackExtract(html);
    if (fallback) return fallback;
  }

  const metadata: PageMetadata = {
    title: article.title || null,
    byline: article.byline || null,
    excerpt: article.excerpt || null,
    siteName: article.siteName || null,
    publishedTime: article.publishedTime || null,
    lang: article.lang || null,
  };

  return { content: article.content, metadata };
}

/**
 * Fallback extraction: re-parse the HTML and use <article> or <main> element
 * directly when Readability's heuristics strip too much content (common on
 * docs sites). Re-parses because Readability mutates the original DOM.
 */
function fallbackExtract(html: string): ExtractResult | null {
  let document: ReturnType<typeof parseHTML>["document"];
  try {
    ({ document } = parseHTML(html));
  } catch {
    return null;
  }

  const el = document.querySelector("article") || document.querySelector("main");
  if (!el || !el.innerHTML) return null;

  const title = document.querySelector("title")?.textContent || null;

  return {
    content: el.innerHTML,
    metadata: {
      title,
      byline: null,
      excerpt: null,
      siteName: null,
      publishedTime: null,
      lang: document.documentElement?.getAttribute("lang") || null,
    },
  };
}

/**
 * Heuristic check: if body text is very short, the page likely
 * needs JavaScript rendering to produce meaningful content.
 *
 * @param html - The raw HTML string to check.
 * @returns `true` if the page has more than 200 characters of body text.
 */
export function isProbablyReaderable(html: string): boolean {
  const { document } = parseHTML(html);
  const textContent = document.body?.textContent || "";
  return textContent.trim().length > 200;
}
