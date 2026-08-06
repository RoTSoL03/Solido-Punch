import { GAME_CONFIG } from '../config'
import type { TrackedFist } from '../types'

export class FistReadinessGate {
  private readySince: number | null = null

  update(
    fists: TrackedFist[],
    now: number,
    isFresh: (id: number) => boolean,
  ): boolean {
    const recognized = fists.filter(
      (fist) => fist.isFist && isFresh(fist.id),
    ).length
    if (recognized < GAME_CONFIG.readiness.requiredFists) {
      this.readySince = null
      return false
    }
    this.readySince ??= now
    return now - this.readySince >= GAME_CONFIG.readiness.holdMs
  }

  reset(): void {
    this.readySince = null
  }
}
