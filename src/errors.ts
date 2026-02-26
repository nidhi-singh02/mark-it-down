/**
 * Custom error classes for web-to-markdown.
 *
 * Typed errors enable consumers to handle specific failure modes
 * programmatically (e.g. retry on timeout, show SSRF to user, etc.)
 * instead of parsing error message strings.
 *
 * All errors support the standard `cause` property for error chaining
 * (ES2022 Error Cause), preserving the original error context.
 */

/** Options accepted by all web-to-markdown error constructors. */
export interface ErrorOptions {
  cause?: unknown;
}

/**
 * Base class for all web-to-markdown errors.
 * Consumers can catch this to handle any library error.
 */
export class MarkitdownError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MarkitdownError";
  }
}

/**
 * Thrown when a URL is invalid or uses an unsupported protocol.
 */
export class ValidationError extends MarkitdownError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when a request is blocked due to SSRF protection
 * (private IPs, internal hostnames, DNS rebinding, etc.)
 */
export class SSRFError extends MarkitdownError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SSRFError";
  }
}

/**
 * Thrown when a network request fails (timeout, DNS failure, HTTP error, etc.)
 */
export class NetworkError extends MarkitdownError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when content cannot be processed (too large, too deeply nested, etc.)
 */
export class ContentError extends MarkitdownError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContentError";
  }
}
