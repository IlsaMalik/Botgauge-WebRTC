import { EventEmitter } from "eventemitter3";

export class SignalingClient extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.emit("open");
    };

    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.emit("message", msg);
    };

    this.ws.onerror = () => {
      this.emit("error");
    };

    this.ws.onclose = (e) => {
      this.emit("close", e.code);
    };
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}