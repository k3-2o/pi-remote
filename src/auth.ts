/**
 * Authentication providers for pi-server.
 *
 * Pluggable system: different providers can be composed.
 * Default (dev): NoAuthProvider — allows all connections.
 * Production: ApiKeyAuthProvider — validates Bearer tokens.
 */

export interface AuthContext {
  transport: "http" | "websocket" | "stdio";
  /** HTTP Authorization header value, if any */
  authorization?: string;
  /** Remote address */
  remoteAddress?: string;
}

export interface AuthResult {
  allowed: boolean;
  reason?: string;
  identity?: string;
}

export interface AuthProvider {
  /** Name for logging */
  readonly name: string;
  /** Authenticate a connection */
  authenticate(context: AuthContext): AuthResult | Promise<AuthResult>;
  /** Optional cleanup */
  dispose?(): void;
}

/**
 * Allows all connections. Default for local development.
 */
export class NoAuthProvider implements AuthProvider {
  readonly name = "none";

  authenticate(_context: AuthContext): AuthResult {
    return { allowed: true, identity: "anonymous" };
  }
}

/**
 * Validates API keys from the Authorization header (Bearer token).
 */
export class ApiKeyAuthProvider implements AuthProvider {
  readonly name = "api-key";
  private validKeys: Set<string>;

  constructor(validKeys: string[]) {
    this.validKeys = new Set(validKeys);
  }

  authenticate(context: AuthContext): AuthResult {
    const header = context.authorization ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1];

    if (!token) {
      return {
        allowed: false,
        reason: "Missing Authorization header (Bearer token required)",
      };
    }

    if (!this.validKeys.has(token)) {
      return { allowed: false, reason: "Invalid API key" };
    }

    return { allowed: true, identity: `api-key:${token.slice(0, 8)}...` };
  }
}

/**
 * Composes multiple auth providers. First allowed wins.
 * If all reject, returns the rejection from the last provider.
 */
export class CompositeAuthProvider implements AuthProvider {
  readonly name = "composite";
  private providers: AuthProvider[];

  constructor(providers: AuthProvider[]) {
    this.providers = providers;
  }

  async authenticate(context: AuthContext): Promise<AuthResult> {
    let lastResult: AuthResult = {
      allowed: false,
      reason: "No auth providers configured",
    };

    for (const provider of this.providers) {
      const result = await Promise.resolve(provider.authenticate(context));
      if (result.allowed) return result;
      lastResult = result;
    }

    return lastResult;
  }

  dispose(): void {
    for (const provider of this.providers) {
      provider.dispose?.();
    }
  }
}
