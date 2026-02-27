import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

const DANGEROUS_PROTOCOLS = [
  "javascript:",
  "data:",
  "vbscript:",
  "jar:",
  "about:",
  "blob:",
] as const;

interface ConverterOptions {
  baseUrl?: string;
}

function isDangerousUrl(href: string): boolean {
  const CONTROL_AND_ZW_RE = /[\x00-\x1f\x7f\u200b-\u200d\ufeff\s]+/g;
  const cleaned = href.replace(CONTROL_AND_ZW_RE, "").toLowerCase();
  return DANGEROUS_PROTOCOLS.some((proto) => cleaned.startsWith(proto));
}

function escapeMarkdownUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function escapeMarkdownTitle(title: string): string {
  return title.replace(/"/g, "&quot;");
}

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
        const buttons = el.querySelectorAll("button");
        Array.from(buttons).forEach((btn) => btn.remove());
        code = el.textContent || "";

        lang = el.getAttribute("data-lang") || "";

        if (!lang) {
          const firstSpan = el.querySelector("span[class]");
          if (firstSpan) {
            const cls = (firstSpan as HTMLElement).getAttribute("class") || "";
            if (/^(gp|go|gt|n|nb|nn|o|p|mi|mf|s[12]?|c1?|k|kn|err)\b/.test(cls)) {
              lang = "python";
            }
          }
        }
      }

      if (lang.length > 50) lang = lang.substring(0, 50);

      code = code.replace(/\n$/, "");

      const backtickRuns = code.match(/`+/g) || [];
      const maxRunLength = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
      const fenceLength = Math.max(3, maxRunLength + 1);
      const fence = "`".repeat(fenceLength);

      return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
    },
  });

  if (options.baseUrl) {
    turndown.addRule("absoluteLinks", {
      filter: "a",
      replacement(content, node) {
        const el = node as HTMLElement;
        const href = el.getAttribute("href");
        if (!href || !content.trim()) return content;

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

  return turndown;
}

function exceedsMaxDepth(html: string, limit: number): boolean {
  let depth = 0;
  const re = /<\/?[a-z][a-z0-9]*\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") {
      depth--;
    } else if (!m[0].endsWith("/>")) {
      if (++depth > limit) return true;
    }
  }
  return false;
}

export function htmlToMarkdown(html: string, options: ConverterOptions = {}): string {
  if (exceedsMaxDepth(html, 500)) {
    throw new Error(
      "HTML content is too deeply nested to process safely. " +
        "The page may contain malformed or adversarial markup."
    );
  }

  const turndown = createTurndownService(options);
  let markdown: string;

  try {
    markdown = turndown.turndown(html);
  } catch (err: unknown) {
    if (err instanceof RangeError) {
      throw new Error(
        "HTML content is too deeply nested to process safely. " +
          "The page may contain malformed or adversarial markup."
      );
    }
    throw err;
  }

  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.trim() + "\n";

  return markdown;
}
