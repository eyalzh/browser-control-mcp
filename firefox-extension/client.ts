import type {
  ExtensionMessage,
  ExtensionError,
  ServerMessageRequest,
} from "@browser-control-mcp/common";
import { getMessageSignature } from "./auth";

const RECONNECT_INTERVAL = 2000; // 2 seconds

export class WebsocketClient {
  private socket: WebSocket | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly secret: string;
  private reconnectTimer: number | null = null;
  private connectionAttempts: number = 0;
  private messageCallback: ((data: ServerMessageRequest) => void) | null = null;

  constructor(host: string, port: number, secret: string) {
    this.host = host;
    this.port = port;
    this.secret = secret;
  }

  public connect(): void {
    console.log(`Connecting to WebSocket server at ${this.host}:${this.port}`);

    this.socket = new WebSocket(`ws://${this.host}:${this.port}`);

    this.socket.addEventListener("open", () => {
      console.log(`Connected to WebSocket server at ${this.host}:${this.port}`);
      this.connectionAttempts = 0;
    });

    this.socket.addEventListener("close", () => {
      console.log(`WebSocket connection closed event at ${this.host}:${this.port}`);
      this.connectionAttempts = 0;
    });

    this.socket.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
    });

    this.socket.addEventListener("message", async (event) => {
      if (this.messageCallback === null) {
        return;
      }
      try {
        const signedMessage = JSON.parse(event.data);
        const messageSig = await getMessageSignature(
          JSON.stringify(signedMessage.payload),
          this.secret
        );
        if (messageSig.length === 0 || messageSig !== signedMessage.signature) {
          console.error("Invalid message signature");
          await this.sendErrorToServer(
            signedMessage.payload.correlationId,
            "Invalid message signature - extension and server not in sync"
          );
          return;
        }
        this.messageCallback(signedMessage.payload);
      } catch (error) {
        console.error("Failed to parse message:", error);
      }
    });

    // Start reconnection timer if not already running
    if (this.reconnectTimer === null) {
      this.startReconnectTimer();
    }
  }

  public addMessageListener(
    callback: (data: ServerMessageRequest) => void
  ): void {
    this.messageCallback = callback;
  }

  private startReconnectTimer(): void {
    this.reconnectTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
        this.connectionAttempts++;

        if (this.connectionAttempts > 2) {
          // Avoid long retry backoff periods by resetting the connection
          this.socket.close();
        }
      }

      if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    }, RECONNECT_INTERVAL);
  }

  public async sendResourceToServer(resource: ExtensionMessage): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error("Socket is not open");
      return;
    }
    const signedMessage = {
      payload: resource,
      signature: await getMessageSignature(
        JSON.stringify(resource),
        this.secret
      ),
    };
    this.socket.send(JSON.stringify(signedMessage));
  }

  public async sendErrorToServer(
    correlationId: string,
    errorMessage: string
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error("Socket is not open", this.socket);
      return;
    }
    const extensionError: ExtensionError = {
      correlationId,
      errorMessage: errorMessage,
    };
    this.socket.send(JSON.stringify(extensionError));
  }

  public disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
