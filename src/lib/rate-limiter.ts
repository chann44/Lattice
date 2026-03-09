export class RateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.requests.get(key) ?? [];
    const valid = timestamps.filter((t) => t >= cutoff);
    if (valid.length >= this.limit) {
      this.requests.set(key, valid);
      return false;
    }
    valid.push(now);
    this.requests.set(key, valid);
    return true;
  }
}
