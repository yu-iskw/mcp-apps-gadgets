import { Client, StreamableHTTPClientTransport, type McpSubscription } from '@modelcontextprotocol/client';

const clientInfo = { name: 'mcp-app-gadgets-realtime', version: '0.1.0' };
const RECONNECT_DELAY_MS = 1_000;

interface Runtime {
  serverUrl: string;
  client: Client;
  dependencies: Map<string, Set<string>>;
  subscription?: McpSubscription;
  generation: number;
  reconnectTimer?: number;
}

export class RealtimeInvalidationManager {
  private readonly runtimes = new Map<string, Promise<Runtime>>();
  private readonly gadgetServers = new Map<string, string>();

  constructor(private readonly onInvalidate: (gadgetId: string) => void) {}

  async setDependencies(serverUrl: string, gadgetId: string, uris: string[]): Promise<void> {
    await this.removeGadget(gadgetId);
    if (uris.length === 0) return;

    const normalized = new URL(serverUrl).href;
    const runtime = await this.getRuntime(normalized);
    this.gadgetServers.set(gadgetId, normalized);
    for (const uri of new Set(uris)) {
      const gadgets = runtime.dependencies.get(uri) ?? new Set<string>();
      gadgets.add(gadgetId);
      runtime.dependencies.set(uri, gadgets);
    }
    await this.refreshSubscription(runtime);
  }

  async removeGadget(gadgetId: string): Promise<void> {
    const serverUrl = this.gadgetServers.get(gadgetId);
    if (!serverUrl) return;
    this.gadgetServers.delete(gadgetId);
    const pending = this.runtimes.get(serverUrl);
    if (!pending) return;
    const runtime = await pending;
    for (const [uri, gadgets] of runtime.dependencies) {
      gadgets.delete(gadgetId);
      if (gadgets.size === 0) runtime.dependencies.delete(uri);
    }
    await this.refreshSubscription(runtime);
  }

  async retainGadgets(gadgetIds: Set<string>): Promise<void> {
    await Promise.all(
      Array.from(this.gadgetServers.keys())
        .filter((id) => !gadgetIds.has(id))
        .map((id) => this.removeGadget(id)),
    );
  }

  private async createClient(serverUrl: string, runtime?: Runtime): Promise<Client> {
    const client = new Client(clientInfo, {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    });
    if (runtime) this.installNotificationHandler(client, runtime);
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl)));
    return client;
  }

  private installNotificationHandler(client: Client, runtime: Runtime) {
    client.setNotificationHandler('notifications/resources/updated', (notification) => {
      const gadgetIds = runtime.dependencies.get(notification.params.uri);
      if (!gadgetIds) return;
      for (const gadgetId of gadgetIds) this.onInvalidate(gadgetId);
    });
  }

  private async getRuntime(serverUrl: string): Promise<Runtime> {
    const existing = this.runtimes.get(serverUrl);
    if (existing) return existing;

    const pending = (async () => {
      const runtime = {
        serverUrl,
        client: undefined as unknown as Client,
        dependencies: new Map<string, Set<string>>(),
        generation: 0,
      } satisfies Runtime;
      runtime.client = await this.createClient(serverUrl, runtime);
      return runtime;
    })().catch((error) => {
      this.runtimes.delete(serverUrl);
      throw error;
    });

    this.runtimes.set(serverUrl, pending);
    return pending;
  }

  private async recoverRuntime(runtime: Runtime, generation: number): Promise<void> {
    if (generation !== runtime.generation || runtime.dependencies.size === 0) return;
    try {
      await runtime.client.close();
    } catch {
      // The transport may already be gone; recovery continues with a new client.
    }
    if (generation !== runtime.generation) return;
    runtime.client = await this.createClient(runtime.serverUrl, runtime);

    // Subscriptions do not replay missed events. Refetch each dependent tile once
    // after reconnect so the UI catches up to the server's authoritative state.
    const gadgetIds = new Set<string>();
    for (const dependencies of runtime.dependencies.values()) {
      for (const gadgetId of dependencies) gadgetIds.add(gadgetId);
    }
    for (const gadgetId of gadgetIds) this.onInvalidate(gadgetId);

    if (generation === runtime.generation) await this.refreshSubscription(runtime);
  }

  private async refreshSubscription(runtime: Runtime): Promise<void> {
    runtime.generation += 1;
    const generation = runtime.generation;
    if (runtime.reconnectTimer !== undefined) {
      window.clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = undefined;
    }
    if (runtime.subscription) {
      await runtime.subscription.close();
      runtime.subscription = undefined;
    }

    const resourceSubscriptions = Array.from(runtime.dependencies.keys());
    if (resourceSubscriptions.length === 0) return;

    const subscription = await runtime.client.listen({ resourceSubscriptions });
    runtime.subscription = subscription;
    void subscription.closed.then((reason) => {
      if (reason === 'local' || generation !== runtime.generation) return;
      runtime.subscription = undefined;
      runtime.reconnectTimer = window.setTimeout(() => {
        runtime.reconnectTimer = undefined;
        void this.recoverRuntime(runtime, generation);
      }, RECONNECT_DELAY_MS);
    });
  }
}
