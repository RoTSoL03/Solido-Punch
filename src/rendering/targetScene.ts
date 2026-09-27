import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import {
  GAME_CONFIG,
  isPowerupTarget,
  type PowerupTargetKind,
  type TargetKind,
} from '../config'
import { getBonusSpawnProfile, selectBonusKind } from '../game/bonusSpawning'
import { getPerformanceProfile } from '../performance/profile'
import { FixedStepAccumulator } from '../physics/fixedStep'
import type { PlayerLane, TargetSnapshot, TrackedFist } from '../types'
import { FistModelOverlay } from './fistModels'

type RapierModule = (typeof import('@dimforge/rapier3d-compat'))['default']

let rapierImport: Promise<RapierModule> | null = null
let rapierInitialization: Promise<void> | null = null

const BONUS_LABELS: Record<PowerupTargetKind, string> = {
  multiplier: '2×',
  time5: '+5',
  time7: '+7',
  time10: '+10',
  heart: '+1',
  shield: 'SH',
  speedAttack: '>>',
  hazardAttack: '!!',
}

interface TargetEntity {
  id: number
  kind: TargetKind
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  radius: number
  hit: boolean
  hitAt: number
  active: boolean
  lane?: PlayerLane
  speedMultiplier: number
}

interface ParticleSlot {
  active: boolean
  position: THREE.Vector3
  velocity: THREE.Vector3
  rotation: number
  expires: number
}

export class TargetScene {
  readonly renderer: THREE.WebGLRenderer
  private readonly profile = getPerformanceProfile()
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  private readonly fistModels = new FistModelOverlay(
    this.scene,
    () => this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1),
  )
  private world!: RAPIER.World
  private rapier!: RapierModule
  private readonly clock = new FixedStepAccumulator(
    GAME_CONFIG.physics.fixedStep,
    GAME_CONFIG.physics.maxFrameDelta,
    GAME_CONFIG.physics.maxSubsteps,
  )
  private targets: TargetEntity[] = []
  private readonly particleGeometry = new THREE.TetrahedronGeometry(0.025, 0)
  private readonly particleMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
  })
  private readonly particleMesh: THREE.InstancedMesh
  private readonly particleSlots: ParticleSlot[]
  private readonly particleTransform = new THREE.Object3D()
  private particleCursor = 0
  private particlesActive = false
  private meshPool = new Map<TargetKind, THREE.Mesh[]>()
  private readonly bonusLabelMaterials = new Map<
    PowerupTargetKind,
    THREE.SpriteMaterial
  >()
  private nextId = 1
  private spawnClock = 0
  private lostContext = false
  private disposed = false
  private viewportWidth = 0
  private viewportHeight = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: this.profile.antialias,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(this.profile.pixelRatio)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.camera.position.z = 3
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x26334d, 2.4))
    const key = new THREE.DirectionalLight(0xffffff, 3)
    key.position.set(-1, 2, 3)
    this.scene.add(key)
    const particleCapacity = Math.max(1, this.profile.particleCount * 4)
    this.particleMesh = new THREE.InstancedMesh(
      this.particleGeometry,
      this.particleMaterial,
      particleCapacity,
    )
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.particleMesh.frustumCulled = false
    this.particleSlots = Array.from({ length: particleCapacity }, () => ({
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      rotation: 0,
      expires: 0,
    }))
    const initialParticleColor = new THREE.Color(0xffffff)
    for (let index = 0; index < particleCapacity; index += 1)
      this.particleMesh.setColorAt(index, initialParticleColor)
    if (this.particleMesh.instanceColor)
      this.particleMesh.instanceColor.needsUpdate = true
    this.updateParticles(performance.now(), 0)
    this.scene.add(this.particleMesh)
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  async initialize(): Promise<void> {
    void this.fistModels.initialize()
    rapierImport ??= import('@dimforge/rapier3d-compat').then(
      ({ default: rapier }) => rapier,
    )
    this.rapier = await rapierImport
    rapierInitialization ??= this.rapier.init()
    await rapierInitialization
    if (this.disposed) return
    this.world = new this.rapier.World({
      x: 0,
      y: GAME_CONFIG.physics.initialGravity,
      z: 0,
    })
    this.resize()
  }

  update(
    delta: number,
    elapsedRatio: number,
    fallSpeed: number,
    spawnInterval: number,
    gravity: number,
    remainingSeconds: number,
    lives: number,
    onMiss: (kind: TargetKind, lane?: PlayerLane) => void,
  ): void {
    this.world.gravity.y = gravity
    this.spawnClock += delta
    if (
      this.spawnClock >= spawnInterval &&
      this.targets.length < GAME_CONFIG.spawning.maxTargets
    ) {
      this.spawnClock = 0
      this.spawn(elapsedRatio, fallSpeed, remainingSeconds, lives)
    }

    this.clock.update(delta, () => this.world.step())
    const now = performance.now()
    for (let index = this.targets.length - 1; index >= 0; index -= 1) {
      const target = this.targets[index]
      if (target.hit) {
        const progress = (now - target.hitAt) / 190
        target.mesh.scale.setScalar(Math.max(0, 1 - progress))
        if (progress >= 1) this.recycle(target)
        continue
      }
      const position = target.body.translation()
      target.mesh.position.set(position.x, position.y, position.z)
      target.mesh.rotation.x += delta * 1.8
      target.mesh.rotation.y += delta * 2.4
      if (position.y < -1.26) {
        onMiss(target.kind, target.lane)
        this.recycle(target)
      }
    }
    this.updateParticles(now, delta)
  }

  render(): void {
    if (!this.lostContext) this.renderer.render(this.scene, this.camera)
  }

  updateFists(fists: TrackedFist[]): void {
    this.fistModels.update(fists)
  }

  hasFistModels(): boolean {
    return this.fistModels.isReady()
  }

  resize(): void {
    const width = Math.max(1, Math.round(this.canvas.clientWidth))
    const height = Math.max(1, Math.round(this.canvas.clientHeight))
    if (width === this.viewportWidth && height === this.viewportHeight) return
    this.viewportWidth = width
    this.viewportHeight = height
    this.renderer.setSize(width, height, false)
    const aspect = width / Math.max(height, 1)
    this.camera.left = -aspect
    this.camera.right = aspect
    this.camera.top = 1
    this.camera.bottom = -1
    this.camera.updateProjectionMatrix()
  }

  snapshots(): TargetSnapshot[] {
    const aspect =
      this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1)
    return this.targets.map((target) => {
      const position = target.body.translation()
      return {
        id: target.id,
        kind: target.kind,
        x: position.x / (2 * aspect) + 0.5,
        y: (1 - position.y) / 2,
        radius: target.radius / 2,
        hit: target.hit,
        lane: target.lane,
      }
    })
  }

  hit(id: number, strength: number): TargetKind | null {
    const target = this.targets.find((item) => item.id === id && item.active)
    if (!target || target.hit) return null
    target.hit = true
    target.hitAt = performance.now()
    target.collider.setEnabled(false)
    const material = target.mesh.material as THREE.MeshStandardMaterial
    material.emissive.setHex(0xffffff)
    material.emissiveIntensity = 1.6
    this.emitParticles(target.mesh.position, material.color, strength)
    return target.kind
  }

  spawnForDemo(kind: TargetKind = 'orb', x = 0): void {
    this.spawn(
      0.2,
      GAME_CONFIG.spawning.initialSpeed,
      GAME_CONFIG.roundDurationSeconds,
      GAME_CONFIG.startingLives,
      kind,
      x,
    )
  }

  spawnForLane(
    kind: TargetKind,
    lane: PlayerLane,
    speed: number,
    speedMultiplier = 1,
  ): void {
    this.spawn(
      1,
      speed * speedMultiplier,
      0,
      3,
      kind,
      undefined,
      lane,
      speedMultiplier,
    )
  }

  countLaneTargets(lane: PlayerLane): number {
    return this.targets.filter((target) => target.lane === lane).length
  }

  setLaneSpeedMultiplier(lane: PlayerLane, multiplier: number): void {
    for (const target of this.targets) {
      if (target.lane !== lane || target.hit) continue
      const ratio = multiplier / target.speedMultiplier
      const velocity = target.body.linvel()
      target.body.setLinvel(
        { x: velocity.x, y: velocity.y * ratio, z: velocity.z },
        true,
      )
      target.speedMultiplier = multiplier
    }
  }

  private spawn(
    elapsedRatio: number,
    speed: number,
    remainingSeconds: number,
    lives: number,
    forcedKind?: TargetKind,
    forcedX?: number,
    lane?: PlayerLane,
    speedMultiplier = 1,
  ): void {
    const bonusProfile = getBonusSpawnProfile(remainingSeconds, lives)
    const roll = Math.random()
    const bonus = roll < bonusProfile.chance
    const hazard =
      !bonus &&
      roll <
        bonusProfile.chance +
          GAME_CONFIG.spawning.hazardChance * (0.65 + elapsedRatio * 0.7)
    const normals: TargetKind[] = ['orb', 'cube', 'crystal']
    const kind =
      forcedKind ??
      (bonus
        ? selectBonusKind(bonusProfile)
        : hazard
          ? 'hazard'
          : normals[Math.floor(Math.random() * normals.length)])
    const radius = GAME_CONFIG.targetTypes[kind].radius
    const aspect =
      this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1)
    const laneRange =
      lane === 'left'
        ? ([0.08, 0.44] as const)
        : lane === 'right'
          ? ([0.56, 0.92] as const)
          : ([0.0875, 0.9125] as const)
    const randomLaneX =
      laneRange[0] + Math.random() * (laneRange[1] - laneRange[0])
    let x = forcedX ?? (randomLaneX - 0.5) * 2 * aspect
    const topTargets = this.targets.filter(
      (target) => target.body.translation().y > 0.72 && target.lane === lane,
    )
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (
        topTargets.every(
          (target) =>
            Math.abs(target.body.translation().x - x) >
            GAME_CONFIG.spawning.minSeparation * aspect,
        )
      )
        break
      const nextLaneX =
        laneRange[0] + Math.random() * (laneRange[1] - laneRange[0])
      x = (nextLaneX - 0.5) * 2 * aspect
    }
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(
          x,
          GAME_CONFIG.spawning.spawnHeight +
            Math.random() * GAME_CONFIG.spawning.spawnHeightJitter,
          0,
        )
        .setLinvel(0, -speed, 0)
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setLinearDamping(0),
    )
    const colliderRadius = radius * (kind === 'cube' ? 1.05 : 1.45)
    const colliderDesc =
      kind === 'cube'
        ? this.rapier.ColliderDesc.cuboid(
            colliderRadius,
            colliderRadius,
            colliderRadius,
          )
        : this.rapier.ColliderDesc.ball(colliderRadius)
    const collider = this.world.createCollider(
      colliderDesc.setSensor(true),
      body,
    )
    const mesh = this.acquireMesh(kind)
    mesh.visible = true
    mesh.scale.setScalar(1)
    this.scene.add(mesh)
    this.targets.push({
      id: this.nextId++,
      kind,
      mesh,
      body,
      collider,
      radius: colliderRadius,
      hit: false,
      hitAt: 0,
      active: true,
      lane,
      speedMultiplier,
    })
  }

  private acquireMesh(kind: TargetKind): THREE.Mesh {
    const pool = this.meshPool.get(kind) ?? []
    const existing = pool.pop()
    if (existing) {
      const material = existing.material as THREE.MeshStandardMaterial
      material.emissive.setHex(GAME_CONFIG.targetTypes[kind].color)
      material.emissiveIntensity = 0.25
      return existing
    }
    const radius = GAME_CONFIG.targetTypes[kind].radius * 1.8
    const geometry = this.createTargetGeometry(kind, radius)
    const material = new THREE.MeshStandardMaterial({
      color: GAME_CONFIG.targetTypes[kind].color,
      roughness: 0.28,
      metalness: 0.24,
      emissive: GAME_CONFIG.targetTypes[kind].color,
      emissiveIntensity: 0.25,
    })
    const mesh = new THREE.Mesh(geometry, material)
    if (kind === 'hazard') {
      const wire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius * 1.23, 0),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          wireframe: true,
          transparent: true,
          opacity: 0.65,
        }),
      )
      mesh.add(wire)
    }
    if (isPowerupTarget(kind)) mesh.add(this.createBonusLabel(kind, radius))
    return mesh
  }

  private createTargetGeometry(
    kind: TargetKind,
    radius: number,
  ): THREE.BufferGeometry {
    if (kind === 'cube')
      return new THREE.BoxGeometry(radius * 1.6, radius * 1.6, radius * 1.6)
    if (kind === 'crystal' || kind === 'heart' || kind === 'shield')
      return new THREE.OctahedronGeometry(radius, 0)
    if (kind === 'hazard') return new THREE.IcosahedronGeometry(radius, 0)
    if (kind === 'multiplier')
      return new THREE.TorusGeometry(radius * 0.62, radius * 0.23, 8, 20)
    if (kind === 'time5' || kind === 'time7' || kind === 'time10') {
      const geometry = new THREE.CylinderGeometry(
        radius * 0.72,
        radius * 0.72,
        radius * 0.42,
        14,
      )
      geometry.rotateX(Math.PI / 2)
      return geometry
    }
    if (kind === 'speedAttack')
      return new THREE.ConeGeometry(radius * 0.82, radius * 1.5, 8)
    if (kind === 'hazardAttack')
      return new THREE.DodecahedronGeometry(radius, 0)
    return new THREE.SphereGeometry(radius, 20, 14)
  }

  private createBonusLabel(
    kind: PowerupTargetKind,
    radius: number,
  ): THREE.Sprite {
    let material = this.bonusLabelMaterials.get(kind)
    if (!material) {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 64
      const context = canvas.getContext('2d')
      if (context) {
        context.fillStyle = 'rgba(4, 7, 12, 0.72)'
        context.fillRect(8, 8, 112, 48)
        context.strokeStyle = '#ffffff'
        context.lineWidth = 4
        context.strokeRect(8, 8, 112, 48)
        context.fillStyle = '#ffffff'
        context.font = '900 36px Arial, sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(BONUS_LABELS[kind], 64, 33)
      }
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      })
      this.bonusLabelMaterials.set(kind, material)
    }
    const label = new THREE.Sprite(material)
    label.position.z = radius * 1.2
    label.scale.set(radius * 1.75, radius * 0.88, 1)
    label.renderOrder = 8
    return label
  }

  private recycle(target: TargetEntity): void {
    if (!target.active) return
    target.active = false
    target.mesh.visible = false
    this.scene.remove(target.mesh)
    this.world.removeRigidBody(target.body)
    const pool = this.meshPool.get(target.kind) ?? []
    pool.push(target.mesh)
    this.meshPool.set(target.kind, pool)
    const index = this.targets.indexOf(target)
    if (index >= 0) this.targets.splice(index, 1)
  }

  private emitParticles(
    position: THREE.Vector3,
    color: THREE.Color,
    strength: number,
  ): void {
    const now = performance.now()
    const particleCount = this.profile.particleCount
    if (particleCount === 0) return
    this.particlesActive = true
    for (let index = 0; index < particleCount; index += 1) {
      const slotIndex = this.particleCursor
      this.particleCursor =
        (this.particleCursor + 1) % this.particleSlots.length
      const particle = this.particleSlots[slotIndex]
      const angle = (index / particleCount) * Math.PI * 2
      particle.active = true
      particle.position.copy(position)
      particle.velocity.set(
        Math.cos(angle) * (0.35 + strength * 0.08),
        Math.sin(angle) * (0.35 + strength * 0.08),
        0,
      )
      particle.rotation = 0
      particle.expires = now + 420
      this.particleMesh.setColorAt(slotIndex, color)
    }
    if (this.particleMesh.instanceColor)
      this.particleMesh.instanceColor.needsUpdate = true
  }

  private updateParticles(now: number, delta: number): void {
    if (!this.particlesActive && delta > 0) return
    let anyActive = false
    for (let index = 0; index < this.particleSlots.length; index += 1) {
      const particle = this.particleSlots[index]
      if (particle.active && now >= particle.expires) particle.active = false
      if (particle.active) {
        anyActive = true
        particle.position.addScaledVector(particle.velocity, delta)
        particle.velocity.y -= delta * 0.6
        particle.rotation += delta * 5
        this.particleTransform.position.copy(particle.position)
        this.particleTransform.rotation.set(
          particle.rotation,
          particle.rotation * 0.7,
          0,
        )
        this.particleTransform.scale.setScalar(1)
      } else {
        this.particleTransform.position.set(0, 0, 0)
        this.particleTransform.rotation.set(0, 0, 0)
        this.particleTransform.scale.setScalar(0)
      }
      this.particleTransform.updateMatrix()
      this.particleMesh.setMatrixAt(index, this.particleTransform.matrix)
    }
    this.particlesActive = anyActive
    this.particleMesh.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    ;[...this.targets].forEach((target) => this.recycle(target))
    this.targets = []
    this.particleSlots.forEach((particle) => {
      particle.active = false
    })
    this.particlesActive = true
    this.updateParticles(performance.now(), 0)
    this.spawnClock = 0
    this.clock.reset()
  }

  dispose(): void {
    this.disposed = true
    this.clear()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    for (const pool of this.meshPool.values()) {
      pool.forEach((mesh) => {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      })
    }
    this.particleGeometry.dispose()
    this.scene.remove(this.particleMesh)
    this.particleMaterial.dispose()
    for (const material of this.bonusLabelMaterials.values()) {
      material.map?.dispose()
      material.dispose()
    }
    this.bonusLabelMaterials.clear()
    this.fistModels.dispose()
    this.renderer.dispose()
    this.world?.free()
  }

  private onLost = (event: Event): void => {
    event.preventDefault()
    this.lostContext = true
  }

  private onRestored = (): void => {
    this.lostContext = false
  }
}
