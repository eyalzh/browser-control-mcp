import type {
  ExtensionMessage,
  ExtensionError,
  ServerMessageRequest,
} from "@browser-control-mcp/common";
import { getMessageSignature } from "./auth";

const RECONNECT_INTERVAL = 2000; // 2 seconds
const CONNECT_TIMEOUT = 2000; // 2 seconds

export class WebsocketClient {
  private socket: WebSocket | null = null;
  private readonly port: number;
  private readonly secret: string;
  private reconnectTimer: number | null = null;
  private manuallyDisconnected = false;
  private messageCallback: ((data: ServerMessageRequest) => void) | null = null;

  constructor(port: number, secret: string) {
    this.port = port;
    this.secret = secret;
  }

  public connect(): void {
    this.manuallyDisconnected = false;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    console.log("Connecting to WebSocket server at port", this.port);
    this.clearReconnectTimer();

    const socket = new WebSocket(`ws://localhost:${this.port}`);
    this.socket = socket;
    const connectTimeout = window.setTimeout(() => {
      if (
        this.socket === socket &&
        socket.readyState === WebSocket.CONNECTING
      ) {
        console.log("WebSocket connection attempt timed out at port", this.port);
        socket.close();
      }
    }, CONNECT_TIMEOUT);

    socket.addEventListener("open", () => {
      window.clearTimeout(connectTimeout);
      console.log("Connected to WebSocket server at port", this.port);
    });

    socket.addEventListener("close", () => {
      window.clearTimeout(connectTimeout);
      console.log("WebSocket connection closed event at port", this.port);
      if (this.socket === socket) {
        this.socket = null;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
      if (
        socket.readyState !== WebSocket.CLOSING &&
        socket.readyState !== WebSocket.CLOSED
      ) {
        socket.close();
      }
    });

    socket.addEventListener("message", async (event) => {
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
  }

  public addMessageListener(
    callback: (data: ServerMessageRequest) => void
  ): void {
    this.messageCallback = callback;
  }

  private scheduleReconnect(): void {
    if (this.manuallyDisconnected || this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) {
      return;
    }
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  public async sendResourceToServer(resource: ExtensionMessage): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error("Socket is not open");
      this.scheduleReconnect();
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
      this.scheduleReconnect();
      return;
    }
    const extensionError: ExtensionError = {
      correlationId,
      errorMessage: errorMessage,
    };
    this.socket.send(JSON.stringify(extensionError));
  }

  public disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
