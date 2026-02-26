import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";
import { ContentError } from "./errors.js";

/** Dangerous URL schemes that must not appear in markdown links. */
const DANGEROUS_PROTOCOLS = [
  "javascript:",
  "data:",
  "vbscript:",
  "jar:",
  "about:",
  "blob:",
] as const;

export interface ConverterOptions {
  /** Base URL for resolving relative URLs to absolute. */
  baseUrl?: string;
  /** If true, strip all images from output. */
  stripImages?: boolean;
}

/**
 * Check if a URL uses a dangerous protocol.
 * Strips all control characters and whitespace before checking to
 * prevent bypass via embedded null bytes, tabs, etc.
 */
function isDangerousUrl(href: string): boolean {
  // Strip all ASCII control characters (U+0000–U+001F), DEL (U+007F),
  // zero-width characters (U+200B–U+200D, U+FEFF), and whitespace
  const CONTROL_AND_ZW_RE = /[\x00-\x1f\x7f\u200b-\u200d\ufeff\s]+/g; // eslint-disable-line no-control-regex
  const cleaned = href.replace(CONTROL_AND_ZW_RE, "").toLowerCase();
  return DANGEROUS_PROTOCOLS.some((proto) => cleaned.startsWith(proto));
}

/**
 * Escape markdown-significant characters in a URL for safe embedding
 * in markdown link syntax [text](url). Encodes ( and ) to prevent
 * premature link termination.
 */
function escapeMarkdownUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * Escape a title string for safe embedding in markdown link title syntax:
 * [text](url "title"). Strips double quotes to prevent title breakout.
 */
function escapeMarkdownTitle(title: string): string {
  return title.replace(/"/g, "&quot;");
}

/**
 * Escape markdown-significant characters in link/image text content.
 * Prevents ] from breaking out of [text] or ![alt] syntax.
 */
function escapeMarkdownBrackets(text: string): string {
  return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function createTurndownService(options: ConverterOptions): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    linkStyle: "inlined",
  });

  turndown.use(gfm);

  // Code blocks — matches ALL <pre> elements. Detects language from:
  //   1. <pre><code class="language-X"> (standard)
  //   2. <pre data-lang="X"> (Code Hike / custom renderers)
  //   3. Syntax-highlighted <span> classes (Sphinx/Pygments, Prism, etc.)
  //   4. Plain <pre> (no language detected)
  turndown.addRule("fencedCodeBlock", {
    filter: "pre",
    replacement(_content, node) {
      const el = node as HTMLElement;
      const codeElement = el.querySelector("code");

      let code: string;
      let lang = "";

      if (codeElement) {
        code = codeElement.textContent || "";
        const className = codeElement.getAttribute("class") || "";
        const langMatch = className.match(/(?:language|lang|highlight)-(\w+)/);
        if (langMatch) lang = langMatch[1];
      } else {
        // Strip interactive elements (e.g. "Copy" buttons) before extracting text
        const buttons = el.querySelectorAll("button");
        Array.from(buttons).forEach((btn: unknown) => (btn as HTMLElement).remove());
        code = el.textContent || "";

        // Detect language from data-lang attribute (Code Hike)
        lang = el.getAttribute("data-lang") || "";

        // Detect language from Sphinx/Pygments span classes (e.g. class="gp" for prompts)
        if (!lang) {
          const firstSpan = el.querySelector("span[class]");
          if (firstSpan) {
            const cls = (firstSpan as HTMLElement).getAttribute("class") || "";
            // Pygments uses short class names: gp (prompt), go (output),
            // n (name), o (operator), c1 (comment), etc.
            if (/^(gp|go|gt|n|nb|nn|o|p|mi|mf|s[12]?|c1?|k|kn|err)\b/.test(cls)) {
              lang = "python"; // Pygments is overwhelmingly used for Python docs
            }
          }
        }
      }

      // Limit language tag length to prevent abuse
      if (lang.length > 50) lang = lang.substring(0, 50);

      code = code.replace(/\n$/, "");

      // Find the longest run of backticks in content and use a longer fence
      const backtickRuns = code.match(/`+/g) || [];
      const maxRunLength = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
      const fenceLength = Math.max(3, maxRunLength + 1);
      const fence = "`".repeat(fenceLength);

      return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
    },
  });

  // Resolve relative URLs to absolute + filter dangerous protocols
  if (options.baseUrl) {
    turndown.addRule("absoluteLinks", {
      filter: "a",
      replacement(content, node) {
        const el = node as HTMLElement;
        const href = el.getAttribute("href");
        if (!href || !content.trim()) return content;

        // Strip dangerous protocols (javascript:, data:, vbscript:, etc.)
        if (isDangerousUrl(href)) return escapeMarkdownBrackets(content);

        try {
          const absoluteUrl = escapeMarkdownUrl(new URL(href, options.baseUrl).toString());
          const title = el.getAttribute("title");
          const safeContent = escapeMarkdownBrackets(content);
          return title
            ? `[${safeContent}](${absoluteUrl} "${escapeMarkdownTitle(title)}")`
            : `[${safeContent}](${absoluteUrl})`;
        } catch {
          return escapeMarkdownBrackets(content);
        }
      },
    });

    turndown.addRule("absoluteImages", {
      filter: "img",
      replacement(_content, node) {
        const el = node as HTMLElement;
        const src = el.getAttribute("src");
        if (!src) return "";

        // Strip dangerous protocols
        if (isDangerousUrl(src)) return "";

        try {
          const absoluteUrl = escapeMarkdownUrl(new URL(src, options.baseUrl).toString());
          const alt = escapeMarkdownBrackets(el.getAttribute("alt") || "");
          const title = el.getAttribute("title");
          return title
            ? `![${alt}](${absoluteUrl} "${escapeMarkdownTitle(title)}")`
            : `![${alt}](${absoluteUrl})`;
        } catch {
          return "";
        }
      },
    });
  } else {
    // Without baseUrl, filter dangerous protocols from links
    turndown.addRule("safeLinkFilter", {
      filter(node) {
        if (node.nodeName !== "A") return false;
        const href = (node as HTMLElement).getAttribute("href");
        return !!href && isDangerousUrl(href);
      },
      replacement(content) {
        return escapeMarkdownBrackets(content);
      },
    });

    // Also filter dangerous protocols from images without baseUrl
    turndown.addRule("safeImageFilter", {
      filter(node) {
        if (node.nodeName !== "IMG") return false;
        const src = (node as HTMLElement).getAttribute("src");
        return !!src && isDangerousUrl(src);
      },
      replacement() {
        return "";
      },
    });
  }

  // Strip images if requested
  if (options.stripImages) {
    turndown.addRule("removeImages", {
      filter: "img",
      replacement: () => "",
    });
  }

  return turndown;
}

/**
 * Convert an HTML string to Markdown.
 *
 * Uses Turndown with GFM extensions. Resolves relative URLs to absolute
 * when `baseUrl` is provided. Filters dangerous protocols and optionally
 * strips images.
 *
 * @param html - The HTML string to convert.
 * @param options - Conversion options.
 * @param options.baseUrl - Base URL for resolving relative links.
 * @param options.stripImages - If `true`, remove all images from output.
 * @returns A Markdown string with trailing newline.
 * @throws {ContentError} If the HTML is too deeply nested to process.
 */
export function htmlToMarkdown(html: string, options: ConverterOptions = {}): string {
  const turndown = createTurndownService(options);
  let markdown: string;

  try {
    markdown = turndown.turndown(html);
  } catch (err: unknown) {
    // Catch stack overflow from deeply nested HTML
    if (err instanceof RangeError) {
      throw new ContentError(
        "HTML content is too deeply nested to process safely. " +
          "The page may contain malformed or adversarial markup.",
        { cause: err }
      );
    }
    throw err;
  }

  // Collapse 3+ blank lines to 2
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.trim() + "\n";

  return markdown;
}
