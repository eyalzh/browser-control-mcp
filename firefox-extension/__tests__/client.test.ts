import { WebsocketClient } from "../client";

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

describe("WebsocketClient", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    Object.defineProperty(global, "WebSocket", {
      value: MockWebSocket,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(global, "WebSocket", {
      value: originalWebSocket,
      writable: true,
      configurable: true,
    });
  });

  it("reconnects after the websocket closes", () => {
    const client = new WebsocketClient(8089, "test-secret");

    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].close();
    jest.advanceTimersByTime(1999);
    expect(MockWebSocket.instances).toHaveLength(1);

    jest.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1].url).toBe("ws://localhost:8089");
  });

  it("retries when a websocket stays stuck connecting", () => {
    const client = new WebsocketClient(8089, "test-secret");

    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    jest.advanceTimersByTime(1999);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CONNECTING);

    jest.advanceTimersByTime(1);
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);

    jest.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("does not create duplicate sockets while already connecting", () => {
    const client = new WebsocketClient(8089, "test-secret");

    client.connect();
    client.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not reconnect after an explicit disconnect", () => {
    const client = new WebsocketClient(8089, "test-secret");

    client.connect();
    client.disconnect();
    jest.advanceTimersByTime(2000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
