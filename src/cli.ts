import { resolve, dirname, sep } from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { convert } from "./index.js";
import { MarkitdownError } from "./errors.js";

/**
 * Read the package version from package.json at runtime.
 * This ensures the CLI `--version` flag always matches the published version
 * without hardcoding it in two places.
 */
function getPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Try ../package.json first (src/ dev), then ../../package.json (dist/bin/ built)
    let pkgPath = resolve(__dirname, "..", "package.json");
    if (!existsSync(pkgPath)) {
      pkgPath = resolve(__dirname, "..", "..", "package.json");
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0"; // Fallback; should never happen in practice
  }
}

/**
 * Validate the output path to prevent writing to sensitive locations.
 * Checks both logical path and real filesystem path (following symlinks).
 */
async function validateOutputPath(outputPath: string): Promise<string> {
  const resolved = resolve(outputPath);
  const cwd = process.cwd();

  // Ensure resolved path is strictly within CWD
  if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
    throw new Error(
      `Output path "${outputPath}" resolves outside the current directory.\n` +
        `Resolved to: ${resolved}\n` +
        "For safety, output files must be within the working directory."
    );
  }

  // Walk up from the target to CWD, checking for links that escape CWD.
  // Use realpath unconditionally on existing components — isSymbolicLink()
  // misses NTFS junctions and other reparse points on Windows.
  let checkPath = resolved;
  while (checkPath !== cwd && checkPath !== dirname(checkPath)) {
    if (existsSync(checkPath)) {
      const realTarget = await realpath(checkPath);
      const realCwd = await realpath(cwd);
      if (!realTarget.startsWith(realCwd + sep) && realTarget !== realCwd) {
        throw new Error(
          `Output path "${outputPath}" resolves outside the current directory.\n` +
            `"${checkPath}" resolves to "${realTarget}".\n` +
            "For safety, output files must not escape the working directory via symlinks or junctions."
        );
      }
      break;
    }
    checkPath = dirname(checkPath);
  }

  return resolved;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("web-to-markdown")
    .description("Convert any web page to clean Markdown")
    .version(getPackageVersion())
    .argument("<url>", "URL of the web page to convert")
    .option("-o, --output <file>", "Write to file instead of stdout")
    .option("-b, --browser", "Force headless browser rendering (for SPAs)", false)
    .option("-r, --raw", "Convert full HTML without content extraction", false)
    .option("-f, --frontmatter", "Include YAML frontmatter with metadata", false)
    .option("--no-images", "Strip images from output")
    .option("--timeout <ms>", "Timeout for page loading in milliseconds", "30000")
    .action(async (url: string, opts: Record<string, unknown>) => {
      try {
        const result = await convert(url, {
          browser: Boolean(opts.browser),
          raw: Boolean(opts.raw),
          frontmatter: Boolean(opts.frontmatter),
          noImages: !opts.images, // commander parses --no-images as images=false
          timeout: Number(opts.timeout),
        });

        // Print any warnings from the library to stderr
        for (const warning of result.warnings) {
          process.stderr.write(`Warning: ${warning}\n`);
        }

        if (opts.output) {
          const safePath = await validateOutputPath(opts.output as string);
          await writeFile(safePath, result.markdown, "utf-8");
          process.stderr.write(`Written to ${safePath}\n`);
        } else {
          process.stdout.write(result.markdown);
        }
      } catch (error: unknown) {
        const prefix = error instanceof MarkitdownError ? error.name : "Error";
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${prefix}: ${message}\n`);
        process.exitCode = 1;
      }
    });

  return program;
}

export async function run(): Promise<void> {
  const program = createProgram();

  // ── Global safety nets ──────────────────────────────────────────────
  // Catch truly unexpected errors that escape all try/catch blocks.
  // Without these, Node exits silently or with a cryptic stack trace.
  process.on("uncaughtException", (err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `Fatal: Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}\n`
    );
    process.exitCode = 1;
  });

  // ── Graceful shutdown ───────────────────────────────────────────────
  // Handle SIGINT/SIGTERM so in-flight work can finish cleanly
  // instead of leaving partial output files or zombie browser processes.
  const onSignal = (signal: string) => {
    process.stderr.write(`\nReceived ${signal}, shutting down…\n`);
    process.exitCode = 130;
    // Allow Node's default handler to finish the process
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  await program.parseAsync(process.argv);
}
