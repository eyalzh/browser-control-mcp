import type {
  ExtensionMessage,
  ExtensionError,
  ServerMessageRequest,
} from "@browser-control-mcp/common";
import { getMessageSignature, verifyMessageSignature } from "./auth";

const RECONNECT_INTERVAL = 2000;
const HANDSHAKE_TIMEOUT_MS = 5000;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const PROTOCOL = "browser-control-mcp:v2";

interface Connection {
  socket: WebSocket;
  nonce: string | null;
  clientNonce: string;
  authenticated: boolean;
  received: number;
  sent: number;
  incoming: Promise<void>;
  outgoing: Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}

export class WebsocketClient {
  private connection: Connection | null = null;
  private readonly port: number;
  private readonly secret: string;
  private reconnectTimer: number | null = null;
  private messageCallback: ((data: ServerMessageRequest) => void) | null = null;

  constructor(port: number, secret: string) {
    this.port = port;
    this.secret = secret;
  }

  public connect(): void {
    const socket = new WebSocket(`ws://localhost:${this.port}`);
    const connection: Connection = {
      socket, nonce: null,
      clientNonce: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""),
      authenticated: false, received: 0, sent: 0,
      incoming: Promise.resolve(), outgoing: Promise.resolve(),
      timer: setTimeout(() => socket.close(), HANDSHAKE_TIMEOUT_MS),
    };
    this.connection = connection;
    socket.addEventListener("close", () => {
      clearTimeout(connection.timer);
      connection.authenticated = false;
    });
    socket.addEventListener("error", () => socket.close());
    socket.addEventListener("message", event => {
      // WebCrypto is asynchronous: serialize verification to preserve wire order.
      connection.incoming = connection.incoming
        .then(() => this.receive(connection, event.data))
        .catch(() => {
          connection.authenticated = false;
          socket.close(1008, "Invalid bridge message");
        });
    });
    if (this.reconnectTimer === null) {
      this.reconnectTimer = window.setInterval(() => {
        if (!this.connection || this.connection.socket.readyState === WebSocket.CLOSED) this.connect();
      }, RECONNECT_INTERVAL);
    }
  }

  private async receive(connection: Connection, data: unknown): Promise<void> {
    if (connection !== this.connection || connection.socket.readyState !== WebSocket.OPEN) return;
    if (typeof data !== "string" || new TextEncoder().encode(data).length > MAX_MESSAGE_BYTES) throw new Error("Invalid frame");
    const frame: unknown = JSON.parse(data);
    if (!isRecord(frame)) throw new Error("Invalid frame");
    if (!connection.authenticated) {
      if (frame.type === "challenge" && frame.version === 2 && connection.nonce === null &&
          typeof frame.nonce === "string" && /^[a-f0-9]{64}$/.test(frame.nonce)) {
        connection.nonce = frame.nonce;
        const signature = await getMessageSignature(
          JSON.stringify([PROTOCOL, "authenticate", "extension", frame.nonce, connection.clientNonce]), this.secret
        );
        if (connection === this.connection && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({ type: "authenticate", nonce: frame.nonce, clientNonce: connection.clientNonce, signature }));
        }
        return;
      }
      if (frame.type !== "ready" || !connection.nonce || frame.nonce !== connection.nonce || frame.clientNonce !== connection.clientNonce ||
          !await verifyMessageSignature(JSON.stringify([PROTOCOL, "authenticate", "server", connection.nonce, connection.clientNonce]), frame.signature, this.secret)) {
        throw new Error("Server authentication failed");
      }
      connection.authenticated = true;
      clearTimeout(connection.timer);
      return;
    }
    if (frame.type !== "message" || !Number.isSafeInteger(frame.sequence) || frame.sequence !== connection.received + 1 ||
        !await verifyMessageSignature(JSON.stringify([PROTOCOL, "message", "server", `${connection.nonce}:${connection.clientNonce}`, frame.sequence, frame.payload]), frame.signature, this.secret)) {
      throw new Error("Invalid authenticated frame");
    }
    if (!isRecord(frame.payload) || typeof frame.payload.cmd !== "string" ||
        typeof frame.payload.correlationId !== "string" || frame.payload.correlationId.length > 128) throw new Error("Invalid command");
    if (connection !== this.connection || connection.socket.readyState !== WebSocket.OPEN) return;
    connection.received++;
    this.messageCallback?.(frame.payload as unknown as ServerMessageRequest);
  }

  public addMessageListener(callback: (data: ServerMessageRequest) => void): void {
    this.messageCallback = callback;
  }

  public sendResourceToServer(resource: ExtensionMessage): Promise<void> {
    return this.send(resource);
  }

  public sendErrorToServer(correlationId: string, errorMessage: string): Promise<void> {
    return this.send({ resource: "error", correlationId, errorMessage });
  }

  private send(payload: ExtensionMessage | ExtensionError): Promise<void> {
    const connection = this.connection;
    if (!connection?.authenticated) return Promise.reject(new Error("Bridge is not authenticated"));
    const send = connection.outgoing.then(async () => {
      if (connection !== this.connection || !connection.authenticated || connection.socket.readyState !== WebSocket.OPEN) throw new Error("Bridge disconnected");
      const sequence = ++connection.sent;
      const signature = await getMessageSignature(
        JSON.stringify([PROTOCOL, "message", "extension", `${connection.nonce}:${connection.clientNonce}`, sequence, payload]), this.secret
      );
      const frame = JSON.stringify({ type: "message", sequence, payload, signature });
      if (new TextEncoder().encode(frame).length > MAX_MESSAGE_BYTES) throw new Error("Bridge response too large");
      if (connection !== this.connection || !connection.authenticated || connection.socket.readyState !== WebSocket.OPEN) throw new Error("Bridge disconnected");
      connection.socket.send(frame);
    });
    connection.outgoing = send.catch(() => {
      connection.authenticated = false;
      connection.socket.close(1008, "Bridge response failed");
    });
    return send;
  }

  public disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connection) {
      clearTimeout(this.connection.timer);
      this.connection.authenticated = false;
      this.connection.socket.close();
      this.connection = null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
