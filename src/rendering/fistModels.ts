import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GAME_CONFIG } from '../config'
import type { TrackedFist } from '../types'

export class FistModelOverlay {
  private template: THREE.Object3D | null = null
  private readonly instances = new Map<number, THREE.Object3D>()
  private readonly lastUsedAt = new Map<number, number>()
  private disposed = false

  constructor(
    private readonly scene: THREE.Scene,
    private readonly getAspect: () => number,
  ) {}

  async initialize(): Promise<void> {
    try {
      const response = await fetch(GAME_CONFIG.fistModel.url, {
        method: 'HEAD',
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || contentType.includes('text/html') || this.disposed)
        return

      const gltf = await new GLTFLoader().loadAsync(GAME_CONFIG.fistModel.url)
      if (this.disposed) return
      const model = gltf.scene
      const bounds = new THREE.Box3().setFromObject(model)
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const largestDimension = Math.max(size.x, size.y, size.z, 0.001)
      model.position.sub(center)
      model.scale.setScalar(1 / largestDimension)
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.castShadow = false
        child.receiveShadow = false
        child.frustumCulled = false
      })
      const template = new THREE.Group()
      template.add(model)
      this.template = template
    } catch {
      // The game remains playable with landmark overlays until the optional GLB exists.
    }
  }

  update(fists: TrackedFist[]): void {
    for (const instance of this.instances.values()) instance.visible = false
    if (!this.template) return

    const now = performance.now()
    const activeIds = new Set<number>()
    const aspect = this.getAspect()
    for (const fist of fists.slice(0, 2)) {
      if (!fist.isFist) continue
      activeIds.add(fist.id)
      this.lastUsedAt.set(fist.id, now)
      const instance = this.getInstance(fist.id)
      const mirror =
        fist.handedness === 'Left'
          ? 1
          : fist.handedness === 'Right'
            ? -1
            : fist.id % 2 === 0
              ? 1
              : -1
      const punchScale =
        fist.phase === 'punching' ? 1.12 : fist.phase === 'cooldown' ? 0.96 : 1
      const scale =
        fist.radius * GAME_CONFIG.fistModel.sizeMultiplier * punchScale

      instance.visible = true
      instance.position.set(
        (fist.center.x - 0.5) * 2 * aspect,
        1 - fist.center.y * 2,
        1,
      )
      instance.rotation.set(
        GAME_CONFIG.fistModel.rotation.x + fist.orientation.x,
        GAME_CONFIG.fistModel.rotation.y + fist.orientation.y * mirror,
        GAME_CONFIG.fistModel.rotation.z + fist.orientation.z,
      )
      instance.scale.set(scale * mirror, scale, scale)
    }

    for (const [id, instance] of this.instances) {
      if (activeIds.has(id) || now - (this.lastUsedAt.get(id) ?? now) < 1500)
        continue
      this.scene.remove(instance)
      this.instances.delete(id)
      this.lastUsedAt.delete(id)
    }
  }

  isReady(): boolean {
    return this.template !== null
  }

  private getInstance(id: number): THREE.Object3D {
    const existing = this.instances.get(id)
    if (existing) return existing
    const instance = clone(this.template!)
    instance.visible = false
    instance.traverse((child) => {
      child.renderOrder = 10
    })
    this.scene.add(instance)
    this.instances.set(id, instance)
    return instance
  }

  dispose(): void {
    this.disposed = true
    for (const instance of this.instances.values()) this.scene.remove(instance)
    this.instances.clear()
    this.lastUsedAt.clear()
    this.template?.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.geometry.dispose()
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material]
      materials.forEach((material) => material.dispose())
    })
    this.template = null
  }
}
