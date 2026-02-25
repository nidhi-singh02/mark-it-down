import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractResult, PageMetadata } from "./types.js";

/**
 * Extract the main article content from raw HTML using
 * Mozilla Readability + linkedom DOM parsing.
 */
export function extractContent(
  html: string,
  url: string
): ExtractResult | null {
  let document: any;
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

  const reader = new Readability(document as any, {
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
    return null;
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
 * Heuristic check: if body text is very short, the page likely
 * needs JavaScript rendering to produce meaningful content.
 */
export function isProbablyReaderable(html: string): boolean {
  const { document } = parseHTML(html);
  const textContent = document.body?.textContent || "";
  return textContent.trim().length > 200;
}
