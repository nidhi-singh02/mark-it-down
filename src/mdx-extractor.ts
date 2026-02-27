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
  // Strategy 1: raw MDX with YAML frontmatter (e.g. Solana, React, Next.js docs)
  const raw = findMdxChunk(html);
  if (raw) {
    const mdx = unescapeRscString(raw);
    return processRawMdx(mdx, url);
  }

  // Strategy 2: compiled MDX functions (Mintlify docs)
  return extractMintlifyMdx(html, url);
}

/**
 * Process raw MDX/markdown text: parse frontmatter, strip JSX components,
 * resolve relative URLs, and clean up whitespace.
 *
 * Used for processing .md endpoint responses and raw MDX from RSC chunks.
 */
export function processRawMdx(mdx: string, url: string): MdxExtractResult {
  // Normalize CRLF to LF so regexes using \n work on Windows-originated content
  const { body, metadata } = parseFrontmatter(mdx.replace(/\r\n/g, "\n"));
  let markdown = stripMdxComponents(body);
  markdown = resolveRelativeUrls(markdown, url);
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

// ─── Mintlify Compiled-MDX Extraction ─────────────────────────────────────────
//
// Mintlify pre-compiles MDX to JavaScript functions in RSC payloads. Instead of
// raw markdown with YAML frontmatter, the chunks contain compiled JSX like:
//   _jsx(_components.p, { children: "text" })
// We evaluate these with mock React primitives to build a plain object tree,
// then walk the tree to produce markdown.

interface MintlifyChunks {
  contentChunk: string;
  metadataChunk: string;
}

/** Scan RSC chunks for Mintlify compiled-MDX content and metadata. */
function findMintlifyChunks(html: string): MintlifyChunks | null {
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let contentChunk: string | null = null;
  let metadataChunk: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1];

    // Content chunk: has _createMdxContent but is NOT the large wrapper with pageMetadata
    if (!contentChunk && raw.includes("_createMdxContent") && !raw.includes('\\"pageMetadata\\"')) {
      contentChunk = unescapeRscString(raw);
    }

    // Metadata chunk: contains pageMetadata
    if (!metadataChunk && raw.includes('\\"pageMetadata\\"')) {
      metadataChunk = unescapeRscString(raw);
    }

    if (contentChunk && metadataChunk) break;
  }

  if (!contentChunk) return null;
  return { contentChunk, metadataChunk: metadataChunk || "" };
}

// ─── Safety Scanning ──────────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  "require(",
  "import(",
  "process.",
  "global.",
  "globalThis.",
  "eval(",
  "fetch(",
  "XMLHttpRequest",
  "WebSocket(",
  "Worker(",
] as const;

function hasDangerousPatterns(code: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => code.includes(p));
}

// ─── JSX Tree Types ──────────────────────────────────────────────────────────

interface JsxNode {
  _type: string;
  children?: JsxChild | JsxChild[];
  [key: string]: unknown;
}

type JsxChild = JsxNode | string | number | boolean | null | undefined;

// ─── Mock React Runtime ──────────────────────────────────────────────────────

/** Known Mintlify component names — must be truthy to pass if(!Card) checks. */
const MINTLIFY_COMPONENTS: Record<string, string> = {
  Card: "Card",
  CardGroup: "CardGroup",
  CodeBlock: "CodeBlock",
  Heading: "Heading",
  Info: "Info",
  Warning: "Warning",
  Note: "Note",
  Tip: "Tip",
  Check: "Check",
  Step: "Step",
  Steps: "Steps",
  Accordion: "Accordion",
  AccordionGroup: "AccordionGroup",
  Tabs: "Tabs",
  Tab: "Tab",
  Callout: "Callout",
  Frame: "Frame",
  Param: "Param",
  ParamField: "ParamField",
  ResponseField: "ResponseField",
  Expandable: "Expandable",
  Icon: "Icon",
  Snippet: "Snippet",
  CodeGroup: "CodeGroup",
};

function createMockRuntime(): Record<string, unknown> {
  const jsx = (type: unknown, props: Record<string, unknown> = {}): JsxNode => {
    // When type is a function (e.g. _jsx(_createMdxContent, props)),
    // call it to get the actual tree node.
    if (typeof type === "function") {
      try {
        return (type as (p: Record<string, unknown>) => JsxNode)(props);
      } catch {
        /* fall through to default */
      }
    }
    const typeName = typeof type === "string" ? type : "unknown";
    return { ...props, _type: typeName };
  };

  return {
    Fragment: "Fragment",
    jsx,
    jsxs: jsx,
    useMDXComponents: () => MINTLIFY_COMPONENTS,
  };
}

// ─── Chunk Evaluation ────────────────────────────────────────────────────────

/** Evaluate a compiled Mintlify MDX chunk and return the JSX tree. */
function evaluateMdxChunk(code: string): JsxNode | null {
  if (hasDangerousPatterns(code)) return null;

  try {
    // The chunk uses arguments[0] to access the React runtime.
    // new Function(body) creates function anonymous() { body },
    // so arguments[0] resolves to the first call argument.
    const fn = new Function(code) as (runtime: Record<string, unknown>) => {
      default?: (props: object) => JsxNode;
    };
    const module = fn(createMockRuntime());
    if (!module?.default) return null;
    return module.default({});
  } catch {
    return null;
  }
}

// ─── JSX Tree → Markdown ─────────────────────────────────────────────────────

interface WalkContext {
  inCodeBlock: boolean;
}

function childrenToArray(children: JsxChild | JsxChild[] | undefined): JsxChild[] {
  if (children === undefined || children === null) return [];
  if (Array.isArray(children)) return children.flat(Infinity) as JsxChild[];
  return [children];
}

function walkChildren(node: JsxNode, ctx: WalkContext): string {
  return childrenToArray(node.children)
    .map((child) => walkNode(child, ctx))
    .join("");
}

function walkNode(node: JsxChild, ctx: WalkContext): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "_type" in node) return jsxTreeToMarkdown(node as JsxNode, ctx);
  return "";
}

/** Extract plain text from a code block's Shiki span tree. */
function extractCodeText(node: JsxNode): string {
  const kids = childrenToArray(node.children);
  return kids
    .map((k) => {
      if (typeof k === "string") return k;
      if (typeof k === "number") return String(k);
      if (k && typeof k === "object" && "_type" in k) return extractCodeText(k as JsxNode);
      return "";
    })
    .join("");
}

/** Get the language string from a JSX node's props. */
function getLanguage(node: JsxNode): string {
  // Check language prop directly
  if (typeof node.language === "string" && node.language) return node.language;
  // Check className for language-xxx pattern
  if (typeof node.className === "string") {
    const m = node.className.match(/language-(\w+)/);
    if (m) return m[1];
  }
  return "";
}

/** Render a fenced code block from a pre or CodeBlock node. */
function renderCodeBlock(node: JsxNode): string {
  let lang = getLanguage(node);
  // Walk into pre > code to find language and text
  const kids = childrenToArray(node.children);
  let codeText = "";
  for (const kid of kids) {
    if (kid && typeof kid === "object" && "_type" in kid) {
      const child = kid as JsxNode;
      if (child._type === "pre" || child._type === "code") {
        if (!lang) lang = getLanguage(child);
        // Recurse deeper for pre > code
        const innerKids = childrenToArray(child.children);
        for (const inner of innerKids) {
          if (inner && typeof inner === "object" && "_type" in inner) {
            const innerNode = inner as JsxNode;
            if (innerNode._type === "code") {
              if (!lang) lang = getLanguage(innerNode);
              codeText = extractCodeText(innerNode);
            } else {
              if (!codeText) codeText = extractCodeText(child);
            }
          }
        }
        if (!codeText) codeText = extractCodeText(child);
      }
    }
  }
  if (!codeText) codeText = extractCodeText(node);

  if (lang.length > 50) lang = lang.substring(0, 50);
  codeText = codeText.replace(/\n$/, "");
  return `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
}

/** Convert a JSX tree node to markdown. */
function jsxTreeToMarkdown(node: JsxNode, ctx: WalkContext): string {
  const type = node._type;

  // Inside a code block, just extract text
  if (ctx.inCodeBlock) {
    return extractCodeText(node);
  }

  switch (type) {
    case "Fragment":
      return walkChildren(node, ctx);

    // ── Block elements ──────────────────────────────────────────────────
    case "p":
      return `\n\n${walkChildren(node, ctx).trim()}\n\n`;

    case "Heading": {
      const level = parseInt(String(node.level), 10) || 2;
      const prefix = "#".repeat(Math.min(level, 6));
      return `\n\n${prefix} ${walkChildren(node, ctx).trim()}\n\n`;
    }

    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = parseInt(type.charAt(1), 10);
      const prefix = "#".repeat(level);
      return `\n\n${prefix} ${walkChildren(node, ctx).trim()}\n\n`;
    }

    case "blockquote": {
      const content = walkChildren(node, ctx).trim();
      return (
        "\n\n" +
        content
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") +
        "\n\n"
      );
    }

    case "hr":
      return "\n\n---\n\n";

    // ── Lists ───────────────────────────────────────────────────────────
    case "ul": {
      const items = childrenToArray(node.children)
        .filter((k) => k && typeof k === "object" && "_type" in k && (k as JsxNode)._type === "li")
        .map((k) => {
          const text = walkChildren(k as JsxNode, ctx).trim();
          return `- ${text}`;
        });
      return "\n\n" + items.join("\n") + "\n\n";
    }

    case "ol": {
      let idx = 0;
      const items = childrenToArray(node.children)
        .filter((k) => k && typeof k === "object" && "_type" in k && (k as JsxNode)._type === "li")
        .map((k) => {
          idx++;
          const text = walkChildren(k as JsxNode, ctx).trim();
          return `${idx}. ${text}`;
        });
      return "\n\n" + items.join("\n") + "\n\n";
    }

    case "li":
      return walkChildren(node, ctx);

    // ── Inline elements ─────────────────────────────────────────────────
    case "a": {
      const href = typeof node.href === "string" ? node.href : "";
      const text = walkChildren(node, ctx);
      if (!href) return text;
      return `[${text}](${href})`;
    }

    case "strong":
    case "b":
      return `**${walkChildren(node, ctx)}**`;

    case "em":
    case "i":
      return `*${walkChildren(node, ctx)}*`;

    case "code":
      return `\`${walkChildren(node, ctx)}\``;

    case "br":
      return "\n";

    case "span":
      return walkChildren(node, ctx);

    case "img": {
      const alt = typeof node.alt === "string" ? node.alt : "";
      const src = typeof node.src === "string" ? node.src : "";
      return `![${alt}](${src})`;
    }

    // ── Code blocks ─────────────────────────────────────────────────────
    case "pre":
    case "CodeBlock":
    case "CodeGroup":
      return renderCodeBlock(node);

    // ── Table ───────────────────────────────────────────────────────────
    case "table":
      return renderTable(node, ctx);

    case "thead":
    case "tbody":
    case "tr":
    case "th":
    case "td":
      // Handled by renderTable
      return walkChildren(node, ctx);

    // ── Mintlify components ─────────────────────────────────────────────
    case "Card": {
      const title = typeof node.title === "string" ? node.title : "";
      const href = typeof node.href === "string" ? node.href : "";
      const body = walkChildren(node, ctx).trim();
      if (title && href) {
        return `\n\n### [${title}](${href})\n\n${body}\n\n`;
      }
      if (title) {
        return `\n\n### ${title}\n\n${body}\n\n`;
      }
      return body ? `\n\n${body}\n\n` : "";
    }

    case "CardGroup":
      return walkChildren(node, ctx);

    case "Warning":
    case "Info":
    case "Note":
    case "Tip":
    case "Check":
    case "Callout": {
      const content = walkChildren(node, ctx).trim();
      const label = type === "Callout" ? "" : type;
      const prefix = label ? `**${label}:** ` : "";
      return (
        "\n\n" +
        content
          .split("\n")
          .map((line, i) => `> ${i === 0 ? prefix : ""}${line}`)
          .join("\n") +
        "\n\n"
      );
    }

    case "Steps": {
      const kids = childrenToArray(node.children);
      let stepNum = 0;
      return kids
        .map((kid) => {
          if (
            kid &&
            typeof kid === "object" &&
            "_type" in kid &&
            (kid as JsxNode)._type === "Step"
          ) {
            stepNum++;
            const step = kid as JsxNode;
            const title = typeof step.title === "string" ? step.title : "";
            const body = walkChildren(step, ctx).trim();
            return `\n\n**${stepNum}. ${title}**\n\n${body}\n`;
          }
          return walkNode(kid, ctx);
        })
        .join("");
    }

    case "Step": {
      // Standalone Step (not inside Steps)
      const title = typeof node.title === "string" ? node.title : "";
      const body = walkChildren(node, ctx).trim();
      return title ? `\n\n**${title}**\n\n${body}\n` : `\n\n${body}\n`;
    }

    case "Accordion": {
      const title = typeof node.title === "string" ? node.title : "";
      const body = walkChildren(node, ctx).trim();
      return `\n\n### ${title}\n\n${body}\n\n`;
    }

    case "AccordionGroup":
    case "Tabs":
      return walkChildren(node, ctx);

    case "Tab": {
      const title =
        typeof node.title === "string"
          ? node.title
          : typeof node.value === "string"
            ? node.value
            : "";
      const body = walkChildren(node, ctx).trim();
      return title ? `\n\n**${title}**\n\n${body}\n\n` : `\n\n${body}\n\n`;
    }

    case "Param":
    case "ParamField":
    case "ResponseField": {
      const name =
        typeof node.name === "string"
          ? node.name
          : typeof node.field === "string"
            ? node.field
            : "";
      const paramType = typeof node.type === "string" ? node.type : "";
      const body = walkChildren(node, ctx).trim();
      const header = name ? `**${name}**${paramType ? ` (${paramType})` : ""}` : "";
      return header ? `\n\n${header}: ${body}\n\n` : body ? `\n\n${body}\n\n` : "";
    }

    case "Frame":
    case "Expandable":
    case "Snippet":
    case "Icon":
      return walkChildren(node, ctx);

    default:
      return walkChildren(node, ctx);
  }
}

/** Render a GFM table from a table JSX node. */
function renderTable(tableNode: JsxNode, ctx: WalkContext): string {
  const rows: string[][] = [];
  let headerRowCount = 0;

  function collectRows(node: JsxNode, isHeader: boolean): void {
    const kids = childrenToArray(node.children);
    for (const kid of kids) {
      if (!kid || typeof kid !== "object" || !("_type" in kid)) continue;
      const n = kid as JsxNode;
      if (n._type === "thead") {
        collectRows(n, true);
      } else if (n._type === "tbody") {
        collectRows(n, false);
      } else if (n._type === "tr") {
        const cells = childrenToArray(n.children)
          .filter((c) => c && typeof c === "object" && "_type" in c)
          .map((c) => walkChildren(c as JsxNode, ctx).trim());
        if (cells.length > 0) {
          rows.push(cells);
          if (isHeader) headerRowCount++;
        }
      }
    }
  }

  collectRows(tableNode, false);
  if (rows.length === 0) return "";

  // Compute column widths
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    Math.max(3, ...rows.map((r) => (r[i] || "").length))
  );

  function formatRow(cells: string[]): string {
    return (
      "| " +
      Array.from({ length: colCount }, (_, i) => (cells[i] || "").padEnd(colWidths[i])).join(
        " | "
      ) +
      " |"
    );
  }

  const lines: string[] = [];
  const headerRows = headerRowCount > 0 ? headerRowCount : 1;

  for (let i = 0; i < rows.length; i++) {
    lines.push(formatRow(rows[i]));
    if (i === headerRows - 1) {
      lines.push("| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |");
    }
  }

  return "\n\n" + lines.join("\n") + "\n\n";
}

// ─── Mintlify Metadata ───────────────────────────────────────────────────────

/** Extract page metadata from a Mintlify wrapper chunk containing pageMetadata. */
function extractMintlifyMetadata(chunk: string): PageMetadata {
  if (!chunk) return emptyMetadata();

  const match = chunk.match(/"pageMetadata"\s*:\s*\{([^}]*)\}/);
  if (!match) return emptyMetadata();

  const block = match[1];
  const titleMatch = block.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const descMatch = block.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);

  let title: string | null = null;
  let excerpt: string | null = null;

  if (titleMatch) {
    try {
      title = JSON.parse(`"${titleMatch[1]}"`);
    } catch {
      title = titleMatch[1];
    }
  }
  if (descMatch) {
    try {
      excerpt = JSON.parse(`"${descMatch[1]}"`);
    } catch {
      excerpt = descMatch[1];
    }
  }

  return {
    title,
    byline: null,
    excerpt,
    siteName: null,
    publishedTime: null,
    lang: null,
  };
}

// ─── Mintlify Orchestrator ───────────────────────────────────────────────────

/** Extract markdown from Mintlify compiled-MDX RSC payloads. */
function extractMintlifyMdx(html: string, url: string): MdxExtractResult | null {
  const chunks = findMintlifyChunks(html);
  if (!chunks) return null;

  const tree = evaluateMdxChunk(chunks.contentChunk);
  if (!tree) return null;

  const ctx: WalkContext = { inCodeBlock: false };
  let markdown = jsxTreeToMarkdown(tree, ctx);

  // Resolve relative URLs
  markdown = resolveRelativeUrls(markdown, url);

  // Collapse excessive blank lines
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.trim() + "\n";

  const metadata = extractMintlifyMetadata(chunks.metadataChunk);

  return { markdown, metadata };
}
