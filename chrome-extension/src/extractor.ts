import { Readability } from "@mozilla/readability";
import type { ExtractResult, PageMetadata } from "./types";

// ─── GitBook Preprocessing ────────────────────────────────────────────────────

function isGitBook(document: Document): boolean {
  return (
    !!document.querySelector("[data-gb-site-header]") ||
    !!document.querySelector("[data-gb-table-of-contents]")
  );
}

function cleanGitBookHtml(document: Document): void {
  document.querySelector("[data-gb-site-header]")?.remove();

  for (const el of document.querySelectorAll("div[hidden]")) el.remove();

  document.querySelector("[data-gb-table-of-contents]")?.remove();
  for (const el of document.querySelectorAll("aside")) el.remove();

  for (const el of document.querySelectorAll("nav")) {
    if (el.getAttribute("aria-label") === "Breadcrumb") {
      el.remove();
    }
  }

  const main = document.querySelector("main");
  if (main) {
    for (const svg of main.querySelectorAll("svg")) svg.remove();
  }

  for (const img of document.querySelectorAll("img")) {
    const cls = img.getAttribute("class") || "";
    if (cls.includes("hidden") && cls.includes("dark:block")) {
      img.remove();
    }
  }

  if (main) {
    for (const p of main.querySelectorAll("p")) {
      const text = p.textContent || "";
      if (text.includes("Was this helpful") || text.startsWith("Last updated")) {
        const parent = p.parentElement;
        if (parent && parent !== main) {
          parent.remove();
        } else {
          p.remove();
        }
      }
    }
  }
}

// ─── DOM Parsing ──────────────────────────────────────────────────────────────

function parseHtml(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

// ─── Content Extraction ───────────────────────────────────────────────────────

export function extractContent(html: string, url: string): ExtractResult | null {
  let document: Document;
  try {
    document = parseHtml(html);
  } catch {
    return null;
  }

  // Inject base URL so Readability resolves relative links
  const baseElement = document.createElement("base");
  baseElement.setAttribute("href", url);
  document.head.appendChild(baseElement);

  if (isGitBook(document)) {
    cleanGitBookHtml(document);
  }

  const reader = new Readability(document, {
    charThreshold: 100,
    maxElemsToParse: 100_000,
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

  // Detect when Readability drops significant content (e.g. code blocks).
  // Readability mutates the DOM, so fallback must re-parse the HTML.
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

function fallbackExtract(html: string): ExtractResult | null {
  let document: Document;
  try {
    document = parseHtml(html);
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
