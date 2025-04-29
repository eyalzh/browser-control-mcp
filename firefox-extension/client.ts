import type {
  ExtensionMessage,
  ExtensionError,
  ServerMessageRequest,
} from "@browser-control-mcp/common";
import { getMessageSignature } from "./auth";

export class WebsocketClient {
  private socket: WebSocket | null = null;
  private readonly port: number;
  private readonly secret: string;
  private reconnectInterval: number = 2000; // 2 seconds
  private reconnectTimer: number | null = null;
  private messageCallback: ((data: ServerMessageRequest) => void) | null = null;

  constructor(port: number, secret: string) {
    this.port = port;
    this.secret = secret;
  }

  public connect(): void {
    console.log("Connecting to WebSocket server");

    this.socket = new WebSocket(`ws://localhost:${this.port}`);

    this.socket.addEventListener("open", () => {
      console.log("Connected to WebSocket server at port", this.port);
    });

    this.socket.addEventListener("close", () => {
      this.socket = null;
    });

    this.socket.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
      this.socket && this.socket.close();
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
      if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    }, this.reconnectInterval);
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
      console.error("Socket is not open");
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
