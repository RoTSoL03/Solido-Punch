export class FixedStepAccumulator {
  private accumulator = 0

  constructor(
    private readonly step: number,
    private readonly maxDelta: number,
    private readonly maxSubsteps: number,
  ) {}

  update(delta: number, advance: (step: number) => void): number {
    this.accumulator += Math.min(Math.max(delta, 0), this.maxDelta)
    let steps = 0
    while (this.accumulator >= this.step && steps < this.maxSubsteps) {
      advance(this.step)
      this.accumulator -= this.step
      steps += 1
    }
    if (steps === this.maxSubsteps)
      this.accumulator = Math.min(this.accumulator, this.step)
    return steps
  }

  reset(): void {
    this.accumulator = 0
  }
}
