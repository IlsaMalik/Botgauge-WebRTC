export class ReconnectManager {
  constructor(startFn, options = {}) {
    this.startFn    = startFn;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelay  = options.baseDelay  ?? 1000;
    this.attempt    = 0;
    this.stopped    = false;
    this.timer      = null;
  }

  async run() {
    this.stopped = false;
    this.attempt = 0;
    await this._try();
  }

  async _try() {
    if (this.stopped) return;

    try {
      await this.startFn();
      this.attempt = 0;
    } catch (err) {
      if (this.stopped) return;

      this.attempt++;

      if (this.attempt > this.maxRetries) {
        console.error("Max retries reached. Giving up.");
        return;
      }

      const delay = this.baseDelay * Math.pow(2, this.attempt - 1);
      console.warn(`Retrying in ${delay}ms... (attempt ${this.attempt}/${this.maxRetries})`);
      this.timer = setTimeout(() => this._try(), delay);
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}