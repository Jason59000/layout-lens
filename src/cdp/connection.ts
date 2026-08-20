import CDP from "chrome-remote-interface";

export interface CDPConnectionOptions {
  host?: string;
  port?: number;
}

/**
 * Persistent CDP connection to a Chrome instance.
 * Keeps the client alive across multiple requests (required for monitoring).
 * Enables DOM, CSS, Page, and Runtime domains on connect.
 */
export class CDPConnection {
  private _client: CDP.Client;
  private _connected: boolean;

  private constructor(client: CDP.Client) {
    this._client = client;
    this._connected = true;
  }

  /**
   * Connect to a Chrome instance via CDP.
   * Activates the DOM, CSS, Page, and Runtime domains.
   *
   * @param options - host (default "localhost") and port (default 9222)
   * @throws If Chrome is not reachable or domains cannot be enabled
   */
  static async connect(
    options?: CDPConnectionOptions,
  ): Promise<CDPConnection> {
    const host = options?.host ?? "localhost";
    const port = options?.port ?? 9222;

    let client: CDP.Client;
    try {
      client = await CDP({ host, port });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to connect to Chrome at ${host}:${port}. ` +
          `Make sure Chrome is running with --remote-debugging-port=${port}. ` +
          `Original error: ${message}`,
      );
    }

    // Enable all required domains in parallel
    try {
      await Promise.all([
        client.DOM.enable(),
        client.CSS.enable(),
        client.Page.enable(),
        client.Runtime.enable(),
      ]);
    } catch (err: unknown) {
      // If domain enabling fails, close the connection before throwing
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
      const message =
        err instanceof Error ? err.message : String(err);
      throw new Error(
        `Connected to Chrome but failed to enable CDP domains: ${message}`,
      );
    }

    const connection = new CDPConnection(client);

    // Listen for disconnect events to update internal state
    client.on("disconnect", () => {
      connection._connected = false;
    });

    return connection;
  }

  /**
   * The underlying CDP client.
   * @throws If the connection has been closed.
   */
  get client(): CDP.Client {
    if (!this._connected) {
      throw new Error(
        "CDP connection is closed. Call CDPConnection.connect() to create a new connection.",
      );
    }
    return this._client;
  }

  /** Whether the connection is still active. */
  get connected(): boolean {
    return this._connected;
  }

  /**
   * Gracefully disconnect from Chrome.
   * Disables activated domains before closing the WebSocket.
   */
  async disconnect(): Promise<void> {
    if (!this._connected) {
      return;
    }

    try {
      // Disable domains (best-effort, don't block on failure)
      await Promise.allSettled([
        this._client.DOM.disable(),
        this._client.CSS.disable(),
        this._client.Page.disable(),
        this._client.Runtime.disable(),
      ]);
    } catch {
      // ignore disable errors
    }

    try {
      await this._client.close();
    } catch {
      // ignore close errors
    }

    this._connected = false;
  }
}
