import { extractMdx } from "./mdx-extractor";
import { extractContent } from "./extractor";
import { htmlToMarkdown } from "./converter";
import type { ConvertResult, PageMetadata } from "./types";

/**
 * Convert a page's HTML to Markdown.
 *
 * Strategy chain:
 *   1. Extract MDX from Next.js RSC payloads (Mintlify, Next.js docs, etc.)
 *   2. Readability content extraction + Turndown HTML-to-Markdown
 */
export function convert(html: string, url: string): ConvertResult {
  let metadata: PageMetadata = {
    title: null,
    byline: null,
    excerpt: null,
    siteName: null,
    publishedTime: null,
    lang: null,
  };

  let markdown: string;

  // Strategy 1: MDX extraction from RSC payloads
  const mdxResult = extractMdx(html, url);

  if (mdxResult) {
    markdown = mdxResult.markdown;
    metadata = mdxResult.metadata;
  } else {
    // Strategy 2: Readability + Turndown
    let contentHtml: string;

    const extracted = extractContent(html, url);

    if (!extracted) {
      contentHtml = html;
    } else {
      contentHtml = extracted.content;
      metadata = extracted.metadata;
    }

    markdown = htmlToMarkdown(contentHtml, { baseUrl: url });
  }

  return { markdown, metadata };
}
