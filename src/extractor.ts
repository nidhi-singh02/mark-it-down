import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractResult, PageMetadata } from "./types.js";

// ─── GitBook Preprocessing ────────────────────────────────────────────────────

type LinkedomDocument = ReturnType<typeof parseHTML>["document"];

/** Detect GitBook pages by their data-gb-* attributes. */
function isGitBook(document: LinkedomDocument): boolean {
  return (
    !!document.querySelector("[data-gb-site-header]") ||
    !!document.querySelector("[data-gb-table-of-contents]")
  );
}

/**
 * Strip GitBook navigation chrome and UI artifacts from the DOM.
 * Must be called before Readability since Readability cannot distinguish
 * navigation elements from content in GitBook's Tailwind-heavy HTML.
 */
function cleanGitBookHtml(document: LinkedomDocument): void {
  // Helper to remove an element from the DOM
  const remove = (el: unknown) => (el as { remove(): void }).remove();

  // 1. Remove site header (top nav with search shortcut ⌘K)
  document.querySelector("[data-gb-site-header]")?.remove();

  // 1b. Remove hidden SSR hydration chunks (contain duplicate UI elements)
  for (const el of document.querySelectorAll("div[hidden]")) remove(el);

  // 2. Remove sidebar table of contents and any aside elements
  document.querySelector("[data-gb-table-of-contents]")?.remove();
  for (const el of document.querySelectorAll("aside")) remove(el);

  // 3. Remove breadcrumb navigation
  for (const el of document.querySelectorAll("nav")) {
    if ((el as unknown as HTMLElement).getAttribute("aria-label") === "Breadcrumb") {
      remove(el);
    }
  }

  // 4. Remove SVG icons that leak text into headings (e.g. "book-open")
  const main = document.querySelector("main");
  if (main) {
    for (const svg of main.querySelectorAll("svg")) remove(svg);
  }

  // 5. Remove dark-mode duplicate images.
  // GitBook renders light + dark variants as sibling <img> tags:
  //   <img class="... block dark:hidden" alt="Cover" ...>  (light)
  //   <img class="... hidden dark:block" alt="Cover" ...>  (dark)
  // Remove the dark variant (hidden by default, shown in dark mode).
  for (const img of document.querySelectorAll("img")) {
    const cls = (img as unknown as HTMLElement).getAttribute("class") || "";
    if (cls.includes("hidden") && cls.includes("dark:block")) {
      remove(img);
    }
  }

  // 6. Remove "Was this helpful?" and "Last updated" footer sections.
  // Both live in a wrapper div after the main content. Match any element
  // containing "Was this helpful" text that isn't the <main> content itself.
  if (main) {
    for (const p of main.querySelectorAll("p")) {
      const text = (p as unknown as HTMLElement).textContent || "";
      if (text.includes("Was this helpful") || text.startsWith("Last updated")) {
        // Remove the nearest block-level parent wrapper
        const parent = (p as unknown as HTMLElement).parentElement;
        if (parent && parent !== main) {
          remove(parent);
        } else {
          remove(p);
        }
      }
    }
  }
}

/**
 * Extract the main article content from raw HTML using
 * Mozilla Readability + linkedom DOM parsing.
 *
 * @param html - The raw HTML string to process.
 * @param url - The page URL, used for resolving relative links.
 * @returns The extracted content and metadata, or `null` if extraction fails.
 */
export function extractContent(html: string, url: string): ExtractResult | null {
  let document: LinkedomDocument;
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

  // Clean site-specific artifacts before Readability
  if (isGitBook(document)) {
    cleanGitBookHtml(document);
  }

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
  let document: LinkedomDocument;
  try {
    ({ document } = parseHTML(html));
  } catch {
    return null;
  }

  if (isGitBook(document)) {
    cleanGitBookHtml(document);
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
