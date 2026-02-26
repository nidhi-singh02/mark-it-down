import type { PageMetadata } from "./types.js";

export interface MdxExtractResult {
  /** Clean markdown content (MDX components stripped). */
  readonly markdown: string;
  /** Metadata parsed from frontmatter. */
  readonly metadata: PageMetadata;
}

/**
 * Attempt to extract raw MDX content from Next.js RSC (React Server Components)
 * payloads embedded in the HTML. Many Next.js documentation sites ship the full
 * markdown source inside `self.__next_f.push([1,"..."])` script tags. This
 * content includes everything — even collapsed accordion and tab content that
 * never renders to the DOM.
 *
 * @param html - The raw HTML string of the page.
 * @param url - The page URL, used for resolving relative links.
 * @returns Extracted markdown and metadata, or `null` if no RSC MDX found.
 */
export function extractMdx(html: string, url: string): MdxExtractResult | null {
  const raw = findMdxChunk(html);
  if (!raw) return null;

  const mdx = unescapeRscString(raw);

  // Parse and strip frontmatter
  const { body, metadata } = parseFrontmatter(mdx);

  // Convert MDX components to plain markdown
  let markdown = stripMdxComponents(body);

  // Resolve relative URLs
  markdown = resolveRelativeUrls(markdown, url);

  // Collapse 3+ blank lines to 2
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.trim() + "\n";

  return { markdown, metadata };
}

// ─── RSC Chunk Extraction ────────────────────────────────────────────────────

/**
 * Scan HTML for `self.__next_f.push([1,"..."])` script tags and return the
 * raw (still-escaped) string of the chunk containing MDX frontmatter.
 */
function findMdxChunk(html: string): string | null {
  // Match self.__next_f.push([1,"..."]) — the content is a JSON-escaped string.
  // Use a non-greedy match on the content between the outer quotes.
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const chunk = match[1];
    // The MDX chunk contains YAML frontmatter: ---\ntitle:
    if (chunk.includes("---\\ntitle:")) {
      return chunk;
    }
  }
  return null;
}

// ─── String Unescaping ───────────────────────────────────────────────────────

/** Unescape a JSON-encoded string from an RSC payload. */
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

/** Parse YAML frontmatter from the top of an MDX string. */
function parseFrontmatter(mdx: string): FrontmatterResult {
  const fmMatch = mdx.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return {
      body: mdx,
      metadata: emptyMetadata(),
    };
  }

  const yamlBlock = fmMatch[1];
  const body = mdx.slice(fmMatch[0].length);

  // Simple YAML key: value parsing (handles multiline with indentation)
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

/** Extract a simple value from a YAML block. Handles multiline indented values. */
function extractYamlValue(yaml: string, key: string): string | null {
  const pattern = new RegExp(`^${key}:\\s*(.*)`, "m");
  const match = yaml.match(pattern);
  if (!match) return null;

  let value = match[1].trim();

  // If the value is empty, it's a multiline value on indented lines below
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

/**
 * Strip MDX/JSX components from markdown content, converting them to plain
 * markdown equivalents where possible.
 */
function stripMdxComponents(mdx: string): string {
  let result = mdx;

  // <Accordion title="X">content</Accordion> → ### X\n\ncontent
  result = result.replace(
    /<Accordion\s+title="([^"]*)"[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/Accordion>/g,
    (_match, title: string, content: string) => `### ${title}\n\n${content.trim()}\n`
  );

  // <Accordions> wrapper → remove
  result = result.replace(/<\/?Accordions>\s*/g, "");

  // <Tab value="X">content</Tab> → **X**\n\ncontent
  result = result.replace(
    /<Tab\s+value="([^"]*)"[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/Tab>/g,
    (_match, value: string, content: string) => `**${value}**\n\n${content.trim()}\n`
  );

  // <Tabs items={[...]}> wrapper → remove
  result = result.replace(/<Tabs\s+[^>]*>\s*/g, "");
  result = result.replace(/<\/Tabs>\s*/g, "");

  // <Callout>content</Callout> → blockquote
  result = result.replace(
    /<Callout[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/Callout>/g,
    (_match, content: string) => {
      const lines = content.trim().split("\n");
      return lines.map((line) => `> ${line}`).join("\n") + "\n";
    }
  );

  // Strip any remaining self-closing JSX components (e.g. <Component />)
  result = result.replace(/<[A-Z]\w+\s*\/>\s*/g, "");

  // Strip any remaining opening/closing JSX component tags (e.g. <Steps>...</Steps>)
  // Only match PascalCase tags (JSX components), not HTML tags
  result = result.replace(/<\/?[A-Z]\w+(?:\s+[^>]*)?\s*>\s*/g, "");

  return result;
}

// ─── URL Resolution ──────────────────────────────────────────────────────────

/** Resolve relative markdown links and images to absolute URLs. */
function resolveRelativeUrls(markdown: string, baseUrl: string): string {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return markdown;
  }

  // [text](/path) → [text](https://example.com/path)
  // ![alt](/path) → ![alt](https://example.com/path)
  return markdown.replace(
    /(\[(?:[^\]\\]|\\.)*\]\()(\/((?:[^)\\]|\\.)*))\)/g,
    (_match, prefix: string, _fullPath: string, path: string) => `${prefix}${origin}/${path})`
  );
}
