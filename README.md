# web-to-markdown

Convert any web page to clean Markdown. Built for developers and LLM pipelines.

## Quick Start

```bash
# No install needed — run directly with npx
npx web-to-markdown https://example.com

# Save to a file
npx web-to-markdown https://example.com -o page.md
```

## Install

```bash
# Global install (use from anywhere)
npm install -g web-to-markdown

# Project dependency (for programmatic API)
npm install web-to-markdown
```

## Usage

```bash
web-to-markdown <url> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <file>` | Write to file instead of stdout |
| `-b, --browser` | Force headless browser rendering (for SPAs) |
| `-r, --raw` | Convert full HTML without content extraction |
| `-f, --frontmatter` | Include YAML frontmatter with metadata |
| `--no-images` | Strip images from output |
| `--timeout <ms>` | Timeout for page loading (default: 30000) |

### Examples

```bash
# Convert a page and print to terminal
web-to-markdown https://en.wikipedia.org/wiki/Markdown

# Save to a file
web-to-markdown https://example.com -o page.md

# Include title, author, date as YAML frontmatter
web-to-markdown https://example.com -f

# Strip all images
web-to-markdown https://example.com --no-images

# Convert raw HTML without content extraction
web-to-markdown https://example.com -r

# Pipe to another tool (only markdown goes to stdout)
web-to-markdown https://example.com | head -20
```

### SPA / JavaScript-Rendered Pages

Some pages (React, Vue, Angular apps) render content with JavaScript. The default HTTP fetch won't capture this. Use `--browser` to launch a headless Chromium instance:

```bash
# One-time setup
npm install playwright
npx playwright install chromium

# Then use the --browser flag
web-to-markdown https://react.dev --browser
```

Playwright is an optional dependency (~100MB) and is only needed for JS-rendered pages.

## Programmatic API

The converter is also usable as a library:

```typescript
import { convert } from "web-to-markdown";

const { markdown, metadata } = await convert("https://example.com", {
  frontmatter: true,
  noImages: false,
});

console.log(metadata.title);
console.log(markdown);
```

Individual modules are also exported:

```typescript
import { fetchPage, extractContent, htmlToMarkdown } from "web-to-markdown";
```

## How It Works

1. **Fetch** -- Downloads the page via HTTP (or Playwright for SPAs)
2. **Extract** -- Mozilla Readability removes boilerplate (nav, footer, ads), keeps the main content
3. **Convert** -- Turndown converts cleaned HTML to Markdown with GFM support (tables, task lists, strikethrough)

## License

MIT
