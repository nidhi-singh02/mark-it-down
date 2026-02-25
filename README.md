# md-tool

Convert any web page to clean Markdown. Built for developers and LLM pipelines.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
node dist/bin/md-tool.js https://example.com
```

## Usage

```bash
md-tool <url> [options]
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
node dist/bin/md-tool.js https://en.wikipedia.org/wiki/Markdown

# Save to a file
node dist/bin/md-tool.js https://example.com -o page.md

# Include title, author, date as YAML frontmatter
node dist/bin/md-tool.js https://example.com -f

# Strip all images
node dist/bin/md-tool.js https://example.com --no-images

# Convert raw HTML without content extraction
node dist/bin/md-tool.js https://example.com -r

# Pipe to another tool (only markdown goes to stdout)
node dist/bin/md-tool.js https://example.com | head -20
```

### SPA / JavaScript-Rendered Pages

Some pages (React, Vue, Angular apps) render content with JavaScript. The default HTTP fetch won't capture this. Use `--browser` to launch a headless Chromium instance:

```bash
# One-time setup
npm install playwright
npx playwright install chromium

# Then use the --browser flag
node dist/bin/md-tool.js https://react.dev --browser
```

Playwright is an optional dependency (~100MB) and is only needed for JS-rendered pages.

## Global Install

To use `md-tool` as a command anywhere:

```bash
npm run build
npm link
md-tool https://example.com
```

## Programmatic API

The converter is also usable as a library:

```typescript
import { convert } from "md-tool";

const { markdown, metadata } = await convert("https://example.com", {
  frontmatter: true,
  noImages: false,
});

console.log(metadata.title);
console.log(markdown);
```

Individual modules are also exported:

```typescript
import { fetchPage, extractContent, htmlToMarkdown } from "md-tool";
```

## How It Works

1. **Fetch** -- Downloads the page via HTTP (or Playwright for SPAs)
2. **Extract** -- Mozilla Readability removes boilerplate (nav, footer, ads), keeps the main content
3. **Convert** -- Turndown converts cleaned HTML to Markdown with GFM support (tables, task lists, strikethrough)

## License

MIT
