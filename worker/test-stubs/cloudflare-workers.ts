// Stand-in for the `cloudflare:workers` module when the Worker is imported by vitest in Node.
export class DurableObject {
  ctx: unknown;
  env: unknown;
  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}
