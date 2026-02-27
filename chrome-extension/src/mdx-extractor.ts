import type { PageMetadata } from "./types";

interface MdxExtractResult {
  readonly markdown: string;
  readonly metadata: PageMetadata;
}

/**
 * Extract raw MDX content from Next.js RSC payloads embedded in HTML.
 * Uses pure regex — no eval/new Function (which MV3 CSP blocks).
 * Mintlify compiled-MDX sites fall through to the Readability path.
 */
export function extractMdx(html: string, url: string): MdxExtractResult | null {
  const raw = findMdxChunk(html);
  if (!raw) return null;

  const mdx = unescapeRscString(raw);
  return processRawMdx(mdx, url);
}

function processRawMdx(mdx: string, url: string): MdxExtractResult {
  const { body, metadata } = parseFrontmatter(mdx);
  let markdown = stripMdxComponents(body);
  markdown = resolveRelativeUrls(markdown, url);
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.trim() + "\n";
  return { markdown, metadata };
}

// ─── RSC Chunk Extraction ────────────────────────────────────────────────────

function findMdxChunk(html: string): string | null {
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const chunk = match[1];
    if (chunk.includes("---\\ntitle:")) {
      return chunk;
    }
  }
  return null;
}

// ─── String Unescaping ───────────────────────────────────────────────────────

function unescapeRscString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\u0027/g, "'")
    .replace(/\\\\/g, "\\");
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

interface FrontmatterResult {
  body: string;
  metadata: PageMetadata;
}

function parseFrontmatter(mdx: string): FrontmatterResult {
  const fmMatch = mdx.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { body: mdx, metadata: emptyMetadata() };
  }

  const yamlBlock = fmMatch[1];
  const body = mdx.slice(fmMatch[0].length);

  const title = extractYamlValue(yamlBlock, "title") || extractYamlValue(yamlBlock, "seoTitle");
  const description = extractYamlValue(yamlBlock, "description");

  return {
    body,
    metadata: {
      title: title || null,
      byline: null,
      excerpt: description || null,
      siteName: null,
      publishedTime: null,
      lang: null,
    },
  };
}

function extractYamlValue(yaml: string, key: string): string | null {
  const pattern = new RegExp(`^${key}:\\s*(.*)`, "m");
  const match = yaml.match(pattern);
  if (!match) return null;

  let value = match[1].trim();

  if (!value) {
    const lines = yaml.split("\n");
    const keyIdx = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (keyIdx === -1) return null;

    const parts: string[] = [];
    for (let i = keyIdx + 1; i < lines.length; i++) {
      if (/^\s+/.test(lines[i])) {
        parts.push(lines[i].trim());
      } else {
        break;
      }
    }
    value = parts.join(" ");
  }

  return value || null;
}

function emptyMetadata(): PageMetadata {
  return {
    title: null,
    byline: null,
    excerpt: null,
    siteName: null,
    publishedTime: null,
    lang: null,
  };
}

// ─── MDX Component Stripping ─────────────────────────────────────────────────

function stripMdxComponents(mdx: string): string {
  let result = mdx;

  result = result.replace(
    /<Accordion\s+title="([^"]*)"[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/Accordion>/g,
    (_match, title: string, content: string) => `### ${title}\n\n${content.trim()}\n`
  );

  result = result.replace(/<\/?Accordions>\s*/g, "");

  result = result.replace(
    /<Tab\s+value="([^"]*)"[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/Tab>/g,
    (_match, value: string, content: string) => `**${value}**\n\n${content.trim()}\n`
  );

  result = result.replace(/<Tabs\s+[^>]*>\s*/g, "");
  result = result.replace(/<\/Tabs>\s*/g, "");

  result = result.replace(
    /<Callout[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/Callout>/g,
    (_match, content: string) => {
      const lines = content.trim().split("\n");
      return lines.map((line) => `> ${line}`).join("\n") + "\n";
    }
  );

  result = result.replace(/<[A-Z]\w+\s*\/>\s*/g, "");
  result = result.replace(/<\/?[A-Z]\w+(?:\s+[^>]*)?\s*>\s*/g, "");

  return result;
}

// ─── URL Resolution ──────────────────────────────────────────────────────────

function resolveRelativeUrls(markdown: string, baseUrl: string): string {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return markdown;
  }

  return markdown.replace(
    /(\[(?:[^\]\\]|\\.)*\]\()(\/((?:[^)\\]|\\.)*))\)/g,
    (_match, prefix: string, _fullPath: string, path: string) => `${prefix}${origin}/${path})`
  );
}
