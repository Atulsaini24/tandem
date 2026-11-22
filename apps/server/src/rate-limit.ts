/**
 * Token bucket: allows bursts up to `burst`, refills at `ratePerSec`. One per connection
 * per message kind, so one noisy client can't starve a document or the server.
 */
export class TokenBucket {
  readonly #rate: number;
  readonly #burst: number;
  readonly #now: () => number;
  #tokens: number;
  #last: number;

  constructor(ratePerSec: number, burst: number, now: () => number = Date.now) {
    this.#rate = ratePerSec;
    this.#burst = burst;
    this.#now = now;
    this.#tokens = burst;
    this.#last = now();
  }

  /** Wait until `count` tokens are available, then take them (backpressure, not rejection). */
  async acquire(count = 1): Promise<void> {
    while (!this.take(count)) {
      const waitMs = ((count - this.#tokens) / this.#rate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, waitMs)));
    }
  }

  take(count = 1): boolean {
    this.#refill();
    if (this.#tokens < count) return false;
    this.#tokens -= count;
    return true;
  }

  /** Tokens available right now (without taking any). */
  available(): number {
    this.#refill();
    return this.#tokens;
  }

  #refill(): void {
    const now = this.#now();
    this.#tokens = Math.min(this.#burst, this.#tokens + ((now - this.#last) / 1000) * this.#rate);
    this.#last = now;
  }
}
