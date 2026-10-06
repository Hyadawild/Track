"use client"

import { useRef, useEffect, useCallback, useState, type ChangeEvent, type InputHTMLAttributes } from "react"
import Link from "next/link"
import { Check, Compass, FolderOpen, Github, Moon, Palette, RotateCcw, Sparkles, Sun, SunMedium, X } from "lucide-react"
import { Button } from "@/components/ui/button"

import {
  Engine,
  type AnimationClip,
  EngineStats,
  MaterialPresetMap,
  Model,
  Quat,
  Vec3,
  parsePmxFolderInput,
  pmxFileAtRelativePath,
} from "reze-engine"

import { MotionCapture } from "./motion-capture"
import Loading from "./loading"

/** The captured clip is registered under its own name and never played, so
 *  exporting cannot disturb the pose the user is driving live. */
const EXPORT_CLIP_NAME = "mikapo-capture"
import { BoneState, SOLVER_REST_BONES, type BodyCollider } from "@/lib/solver"
import { FaceSolverResult } from "@/lib/face-blendshape-solver"
import { ASSETS } from "@/lib/assets"

/** Stable engine key for the bundled default PMX — folder uploads swap via removeModel + new id. */
const DEFAULT_MODEL_KEY = "Suisui"

// Whether this build ships the demo model (absent = on). Set
// NEXT_PUBLIC_USE_DEFAULT_ASSETS=false to boot empty; parsed leniently, same
// convention as reze-design. Read at build time (NEXT_PUBLIC_ inlines it).
const NO = ["false", "0", "off", "no"]
const USE_DEFAULT_ASSETS = !NO.includes((process.env.NEXT_PUBLIC_USE_DEFAULT_ASSETS ?? "false").trim().toLowerCase())

/** Style-group hints for the bundled 塞尔凯特 PMX (exact material names). Fed to
 *  `engine.autoStyleGroups` as overrides: these win, then the engine's built-in
 *  JP/CN/EN name hints fill in anything else — so an arbitrary standard MMD
 *  upload still auto-styles even though we only enumerate the default model here. */
const DEFAULT_STYLE_OVERRIDES: MaterialPresetMap = {
  eye: ["眼睛", "眼白", "目白", "右瞳", "左瞳", "眉毛", "eyebrow", "eyelash"],
  face: ["脸", "face01"],
  body: ["皮肤", "skin"],
  hair: ["头发", "hair_f"],
  cloth_smooth: [
    "衣服",
    "裙子",
    "裙带",
    "裙布",
    "外套",
    "外套饰",
    "裤子",
    "裤子0",
    "腿环",
    "发饰",
    "鞋子",
    "鞋子饰",
    "shirt",
    "shoes",
    "shorts",
    "trigger",
    "dress",
    "hair_accessory",
    "cloth01_shoes",
  ],
  stockings: ["袜子", "stockings"],
  metal: ["metal01", "earring"],
}

function fileStem(filename: string) {
  const i = filename.lastIndexOf(".")
  return i >= 0 ? filename.slice(0, i) : filename
}

/** webkitdirectory attrs — cast kept outside JSX so `<` is not parsed as a tag */
const pmxFolderInputAttrs = {
  webkitdirectory: "",
  mozdirectory: "",
} as InputHTMLAttributes<HTMLInputElement>

/** Background configuration presets for the scene */
export interface BackgroundPreset {
  id: string
  name: string
  description?: string
  css: string
  bodyColor: string
  groundColor: Vec3
  gridLineColor: Vec3
  bloomColor: Vec3
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: "white-gray-gradient",
    name: "Gradien Putih-Abu",
    description: "Neutral studio white-gray gradient",
    css: "radial-gradient(circle at 50% 50%, #ffffff 0%, #f1f5f9 45%, #cbd5e1 100%)",
    bodyColor: "#cbd5e1",
    groundColor: new Vec3(0.92, 0.94, 0.96),
    gridLineColor: new Vec3(0.78, 0.80, 0.85),
    bloomColor: new Vec3(0.95, 0.95, 0.95),
  },
  {
    id: "studio-gray",
    name: "Studio Abu-Abu",
    description: "Sleek soft studio lighting",
    css: "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 40%, #94a3b8 100%)",
    bodyColor: "#94a3b8",
    groundColor: new Vec3(0.85, 0.87, 0.90),
    gridLineColor: new Vec3(0.70, 0.73, 0.78),
    bloomColor: new Vec3(0.9, 0.9, 0.9),
  },
  {
    id: "purple-gradient",
    name: "Gradien Ungu (Original)",
    description: "Classic MiKaPo purple atmosphere",
    css: "radial-gradient(circle at 50% 55%, #86198f 0%, #581c87 40%, #4a044e 100%)",
    bodyColor: "#4a044e",
    groundColor: new Vec3(0.9, 0.1, 0.9),
    gridLineColor: new Vec3(0.85, 0.85, 0.85),
    bloomColor: new Vec3(0.5, 0.1, 0.9),
  },
  {
    id: "dark-charcoal",
    name: "Dark Charcoal",
    description: "Dark ambient studio",
    css: "radial-gradient(circle at 50% 55%, #334155 0%, #1e293b 45%, #090d16 100%)",
    bodyColor: "#090d16",
    groundColor: new Vec3(0.18, 0.22, 0.28),
    gridLineColor: new Vec3(0.35, 0.40, 0.45),
    bloomColor: new Vec3(0.7, 0.8, 1.0),
  },
  {
    id: "cyberpunk-blue",
    name: "Cyberpunk Blue",
    description: "Cool blue neon mood",
    css: "radial-gradient(circle at 50% 55%, #0284c7 0%, #0c4a6e 45%, #030712 100%)",
    bodyColor: "#030712",
    groundColor: new Vec3(0.1, 0.55, 0.85),
    gridLineColor: new Vec3(0.3, 0.7, 0.9),
    bloomColor: new Vec3(0.2, 0.6, 1.0),
  },
  {
    id: "green-screen",
    name: "Green Screen",
    description: "Solid green for chroma-key streaming",
    css: "#00ff00",
    bodyColor: "#00ff00",
    groundColor: new Vec3(0.0, 1.0, 0.0),
    gridLineColor: new Vec3(0.0, 0.88, 0.0),
    bloomColor: new Vec3(0.0, 0.0, 0.0),
  },
]

export interface LightingSettings {
  exposure: number
  sunStrength: number
  worldStrength: number
  bloomIntensity: number
  sunColor: string
  sunAzimuth: number // horizontal angle degrees: -180 to 180 (0 = front, 90 = right, -90 = left, 180 = back)
  sunElevation: number // vertical elevation degrees: 10 to 85 (height above horizon)
}

export const DEFAULT_LIGHTING: LightingSettings = {
  exposure: 0.6,
  sunStrength: 2.0,
  worldStrength: 0.3,
  bloomIntensity: 0.03,
  sunColor: "#ffffff",
  sunAzimuth: 5,
  sunElevation: 23,
}

export interface LightingPreset {
  id: string
  name: string
  description: string
  settings: LightingSettings
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: "default",
    name: "Alami",
    description: "Pencahayaan seimbang default",
    settings: {
      exposure: 0.6,
      sunStrength: 2.0,
      worldStrength: 0.3,
      bloomIntensity: 0.03,
      sunColor: "#ffffff",
      sunAzimuth: 5,
      sunElevation: 23,
    },
  },
  {
    id: "bright",
    name: "Terang",
    description: "Studio terang & jelas",
    settings: {
      exposure: 0.9,
      sunStrength: 2.6,
      worldStrength: 0.5,
      bloomIntensity: 0.04,
      sunColor: "#ffffff",
      sunAzimuth: 25,
      sunElevation: 35,
    },
  },
  {
    id: "dramatic",
    name: "Dramatis",
    description: "Kontras tinggi bayangan pekat",
    settings: {
      exposure: 0.3,
      sunStrength: 3.0,
      worldStrength: 0.1,
      bloomIntensity: 0.02,
      sunColor: "#ffffff",
      sunAzimuth: 60,
      sunElevation: 20,
    },
  },
  {
    id: "warm",
    name: "Hangat",
    description: "Nuansa golden sunset",
    settings: {
      exposure: 0.6,
      sunStrength: 2.3,
      worldStrength: 0.35,
      bloomIntensity: 0.05,
      sunColor: "#ffe0b2",
      sunAzimuth: 35,
      sunElevation: 18,
    },
  },
  {
    id: "cool",
    name: "Sejuk",
    description: "Nuansa malam/neon biru",
    settings: {
      exposure: 0.5,
      sunStrength: 2.0,
      worldStrength: 0.25,
      bloomIntensity: 0.06,
      sunColor: "#b3e5fc",
      sunAzimuth: -40,
      sunElevation: 25,
    },
  },
]

export interface DirectionPreset {
  id: string
  name: string
  azimuth: number
  elevation: number
}

export const DIRECTION_PRESETS: DirectionPreset[] = [
  { id: "front", name: "Depan", azimuth: 0, elevation: 25 },
  { id: "front-right", name: "Kanan 3/4", azimuth: 45, elevation: 30 },
  { id: "front-left", name: "Kiri 3/4", azimuth: -45, elevation: 30 },
  { id: "side-right", name: "Samping", azimuth: 90, elevation: 20 },
  { id: "back", name: "Belakang (Rim)", azimuth: 180, elevation: 30 },
  { id: "top", name: "Atas", azimuth: 0, elevation: 75 },
]

function computeSunDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const azRad = (azimuthDeg * Math.PI) / 180
  const elRad = (elevationDeg * Math.PI) / 180
  const cosEl = Math.cos(elRad)
  const dirX = -Math.sin(azRad) * cosEl
  const dirY = -Math.sin(elRad)
  const dirZ = Math.cos(azRad) * cosEl
  return new Vec3(dirX, dirY, dirZ)
}

function getAzimuthLabel(deg: number): string {
  if (Math.abs(deg) <= 15) return "Depan"
  if (deg > 15 && deg <= 65) return "Depan Kanan"
  if (deg > 65 && deg <= 115) return "Samping Kanan"
  if (deg > 115 && deg <= 165) return "Belakang Kanan"
  if (Math.abs(deg) > 165) return "Belakang"
  if (deg < -15 && deg >= -65) return "Depan Kiri"
  if (deg < -65 && deg >= -115) return "Samping Kiri"
  return "Belakang Kiri"
}

function hexToVec3(hex: string): Vec3 {
  const clean = hex.replace("#", "")
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255
    const g = parseInt(clean.slice(2, 4), 16) / 255
    const b = parseInt(clean.slice(4, 6), 16) / 255
    return new Vec3(r, g, b)
  }
  return new Vec3(1, 1, 1)
}

export default function MainScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modelRef = useRef<Model | null>(null)
  const engineRef = useRef<Engine | null>(null)
  /** Engine registry name for removeModel when replacing the avatar */
  const loadedModelNameRef = useRef(DEFAULT_MODEL_KEY)
  const pmxFolderInputRef = useRef<HTMLInputElement>(null)
  /** Bumped on folder upload so a still-in-flight default `loadModel` can discard its result. */
  const loadGenerationRef = useRef(0)
  const [modelLoaded, setModelLoaded] = useState(false)
  const [restPose, setRestPose] = useState<Record<string, Vec3> | null>(null)
  const [colliders, setColliders] = useState<BodyCollider[] | null>(null)
  const [modelMorphs, setModelMorphs] = useState<string[] | null>(null)
  const [mediaPipeReady, setMediaPipeReady] = useState(false)
  /** After `engine.init()` — folder picker is safe (loadModel still async for default PMX). */
  const [engineInited, setEngineInited] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [stats, setStats] = useState<EngineStats | null>(null)
  const [pmxPickFiles, setPmxPickFiles] = useState<File[] | null>(null)
  const [pmxPickPaths, setPmxPickPaths] = useState<string[]>([])
  const [pmxPickSelected, setPmxPickSelected] = useState("")

  const [selectedBgId, setSelectedBgId] = useState<string>("white-gray-gradient")
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const bgMenuRef = useRef<HTMLDivElement>(null)

  const activePreset = BACKGROUND_PRESETS.find((p) => p.id === selectedBgId) ?? BACKGROUND_PRESETS[0]
  const activePresetRef = useRef(activePreset)
  activePresetRef.current = activePreset

  const [lighting, setLighting] = useState<LightingSettings>(DEFAULT_LIGHTING)
  const [lightingTab, setLightingTab] = useState<"intensity" | "direction">("intensity")
  const [lightMenuOpen, setLightMenuOpen] = useState(false)
  const lightMenuRef = useRef<HTMLDivElement>(null)
  const lightingRef = useRef<LightingSettings>(lighting)
  lightingRef.current = lighting

  const applyBackgroundPreset = useCallback((preset: BackgroundPreset) => {
    setSelectedBgId(preset.id)
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("mikapo_bg", preset.id)
      } catch {}
      document.body.style.backgroundColor = preset.bodyColor
    }
    if (engineRef.current) {
      engineRef.current.addGround({
        diffuseColor: preset.groundColor,
        gridLineColor: preset.gridLineColor,
      })
      engineRef.current.setBloomOptions({
        color: preset.bloomColor,
      })
    }
  }, [])

  const applyLighting = useCallback((settings: LightingSettings) => {
    setLighting(settings)
    lightingRef.current = settings
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("mikapo_lighting", JSON.stringify(settings))
      } catch {}
    }
    if (engineRef.current) {
      engineRef.current.setViewTransformOptions({
        exposure: settings.exposure,
      })
      engineRef.current.setSun({
        strength: settings.sunStrength,
        color: hexToVec3(settings.sunColor),
        direction: computeSunDirection(settings.sunAzimuth, settings.sunElevation),
      })
      engineRef.current.setWorld({
        strength: settings.worldStrength,
      })
      engineRef.current.setBloomOptions({
        intensity: settings.bloomIntensity,
        enabled: settings.bloomIntensity > 0,
      })
    }
  }, [])

  const updateLightingField = useCallback(
    <K extends keyof LightingSettings>(field: K, value: LightingSettings[K]) => {
      const updated = { ...lightingRef.current, [field]: value }
      applyLighting(updated)
    },
    [applyLighting],
  )

  // Restore saved background & lighting from localStorage on mount
  useEffect(() => {
    try {
      const savedBg = localStorage.getItem("mikapo_bg")
      const found = BACKGROUND_PRESETS.find((p) => p.id === savedBg)
      if (found) {
        setSelectedBgId(found.id)
        document.body.style.backgroundColor = found.bodyColor
        if (engineRef.current) {
          engineRef.current.addGround({
            diffuseColor: found.groundColor,
            gridLineColor: found.gridLineColor,
          })
          engineRef.current.setBloomOptions({
            color: found.bloomColor,
          })
        }
      } else {
        document.body.style.backgroundColor = BACKGROUND_PRESETS[0].bodyColor
      }

      const savedLight = localStorage.getItem("mikapo_lighting")
      if (savedLight) {
        const parsed = JSON.parse(savedLight) as Partial<LightingSettings>
        const merged: LightingSettings = { ...DEFAULT_LIGHTING, ...parsed }
        setLighting(merged)
        lightingRef.current = merged
        if (engineRef.current) {
          engineRef.current.setViewTransformOptions({ exposure: merged.exposure })
          engineRef.current.setSun({
            strength: merged.sunStrength,
            color: hexToVec3(merged.sunColor),
            direction: computeSunDirection(merged.sunAzimuth, merged.sunElevation),
          })
          engineRef.current.setWorld({ strength: merged.worldStrength })
          engineRef.current.setBloomOptions({ intensity: merged.bloomIntensity, enabled: merged.bloomIntensity > 0 })
        }
      }
    } catch {}
  }, [])

  // Close menus when clicking outside
  useEffect(() => {
    if (!bgMenuOpen && !lightMenuOpen) return
    const handleClickOutside = (ev: MouseEvent) => {
      const target = ev.target as Node
      if (bgMenuRef.current && !bgMenuRef.current.contains(target)) {
        setBgMenuOpen(false)
      }
      if (lightMenuRef.current && !lightMenuRef.current.contains(target)) {
        setLightMenuOpen(false)
      }
    }
    window.addEventListener("mousedown", handleClickOutside)
    return () => window.removeEventListener("mousedown", handleClickOutside)
  }, [bgMenuOpen, lightMenuOpen])

  // Build a rest-pose dict from the model's bone world positions. Solver uses
  // these to derive per-bone reference directions instead of the static defaults.
  /** Frame the character the way reze-design does: the orbit centre rides
   *  センター with a small lift, eased rather than bolted on. It matters more
   *  here than there — grounding moves センター now, so a crouch would otherwise
   *  drop out of frame. */
  const followModel = useCallback(
    (model: Model) => {
      engineRef.current?.setCameraFollow(model, "センター", new Vec3(0, 3, 0), 0.15)
    },
    [engineRef],
  )

  const buildRestPose = useCallback((model: Model) => {
    const dict: Record<string, Vec3> = {}
    for (const name of SOLVER_REST_BONES) {
      try {
        const p = model.getBoneWorldPosition(name)
        if (p) dict[name] = new Vec3(p.x, p.y, p.z)
      } catch {
        // bone missing — solver falls back to DEFAULT_REFS
      }
    }
    setRestPose(dict)

    // The model's own rigid bodies double as its body volume: the author already
    // shaped capsules to fit this character. The solver uses them to keep arms
    // out of the chest (MMD physics never tests these pairs — they are all
    // bone-following statics, so the broadphase drops them).
    const bones = model.getSkeleton().bones
    setColliders(
      model.getRigidbodies().map((rb) => ({
        bone: bones[rb.boneIndex]?.name ?? "",
        shape: rb.shape as number,
        size: { x: rb.size.x, y: rb.size.y, z: rb.size.z },
        position: { x: rb.shapePosition.x, y: rb.shapePosition.y, z: rb.shapePosition.z },
      })),
    )

    // Morph list for blendshape mapping resolution. reze-engine keeps this
    // private today — worth upstreaming a public getMorphNames() (resetAllMorphs
    // already iterates the same data).
    try {
      const morphs = (model as unknown as { morphing?: { morphs?: { name: string }[] } }).morphing?.morphs
      setModelMorphs(morphs ? morphs.map((m) => m.name) : null)
    } catch {
      setModelMorphs(null)
    }
  }, [])

  const initEngine = useCallback(async () => {
    if (canvasRef.current) {
      try {
        const preset = activePresetRef.current
        const light = lightingRef.current
        const sunDir = computeSunDirection(light.sunAzimuth, light.sunElevation)
        const engine = new Engine(canvasRef.current, {
          bloom: { color: preset.bloomColor, intensity: light.bloomIntensity, enabled: light.bloomIntensity > 0 },
          view: { exposure: light.exposure },
          sun: { strength: light.sunStrength, color: hexToVec3(light.sunColor), direction: sunDir },
          world: { strength: light.worldStrength },
          // Further out than the engine default: a capture is watched whole —
          // raised arms and a deep crouch both have to stay in frame.
          camera: { distance: 30 },
        })
        engineRef.current = engine
        await engine.init()
        setEngineInited(true)
        engine.setViewTransformOptions({ exposure: light.exposure })
        engine.setSun({ strength: light.sunStrength, color: hexToVec3(light.sunColor), direction: sunDir })
        engine.setWorld({ strength: light.worldStrength })
        engine.setBloomOptions({ intensity: light.bloomIntensity, enabled: light.bloomIntensity > 0 })
        // MiKaPo poses the skeleton itself — FK rotations written every frame,
        // no clip playing — so the engine must not also run IK and fight them.
        // The exported motion still carries its own per-chain state for whoever
        // plays it back.
        engine.setIKEnabled(false)
        engine.runRenderLoop(() => {
          setStats(engine.getStats())
        })

        if (!USE_DEFAULT_ASSETS) {
          // No bundled model: the scene boots empty (ground only) and the user
          // brings their own PMX via the folder picker.
          engine.addGround({ diffuseColor: preset.groundColor, gridLineColor: preset.gridLineColor })
          return
        }

        const genBeforeDefault = loadGenerationRef.current
        try {
          const model = await engine.loadModel(DEFAULT_MODEL_KEY, `${ASSETS}/models/塞尔凯特/塞尔凯特.pmx`)
          if (genBeforeDefault !== loadGenerationRef.current) {
            try {
              engine.removeModel(DEFAULT_MODEL_KEY)
            } catch {
              /* raced folder upload already replaced registry */
            }
            return
          }

          modelRef.current = model
          loadedModelNameRef.current = DEFAULT_MODEL_KEY
          console.log(model.getMaterials())

          await engine.autoStyleGroups(loadedModelNameRef.current, DEFAULT_STYLE_OVERRIDES)
          setModelLoaded(true)
          await new Promise((r) => requestAnimationFrame(r))
          buildRestPose(model)
          followModel(model)
          engine.addGround({ diffuseColor: preset.groundColor, gridLineColor: preset.gridLineColor })
          setEngineError(null)
        } catch (loadErr) {
          setEngineError(loadErr instanceof Error ? loadErr.message : "Unknown error")
        }

        // await engine.loadAnimation("/mikapo_animation.vmd")
        // engine.playAnimation()
      } catch (error) {
        setEngineError(error instanceof Error ? error.message : "Unknown error")
      }
    }
  }, [buildRestPose, followModel])

  useEffect(() => {
    void (async () => {
      initEngine()
    })()

    // Cleanup on unmount
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose()
      }
    }
  }, [initEngine])

  const loadPmxFromFolder = useCallback(
    async (files: File[], pmxFile: File) => {
      const engine = engineRef.current
      if (!engine) {
        window.alert("Viewport is not ready yet. Wait for initialization, then try again.")
        return
      }
      loadGenerationRef.current += 1
      const stem = fileStem(pmxFile.name)
      const instanceKey = `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
      try {
        try {
          engine.removeModel(loadedModelNameRef.current)
        } catch {
          /* removeModel no-op if name stale */
        }
        const model = await engine.loadModel(instanceKey, { files, pmxFile })
        await new Promise((resolve) => requestAnimationFrame(resolve))
        model.setName(stem)
        modelRef.current = model
        loadedModelNameRef.current = instanceKey
        await engine.autoStyleGroups(loadedModelNameRef.current, DEFAULT_STYLE_OVERRIDES)
        setModelLoaded(true)
        buildRestPose(model)
        followModel(model)
        setEngineError(null)
      } catch (e) {
        console.error("[pmx-upload] loadModel failed:", e)
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [buildRestPose, followModel],
  )

  const onPickPmxFolder = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      try {
        const picked = parsePmxFolderInput(e.target.files)
        e.target.value = ""

        if (picked.status === "empty") return
        if (picked.status === "not_directory") {
          window.alert("Please select a folder, not individual files.")
          return
        }
        if (picked.status === "no_pmx") {
          window.alert("No .pmx file in the selected folder.")
          return
        }

        setPmxPickFiles(null)
        setPmxPickPaths([])
        setPmxPickSelected("")

        if (picked.status === "single") {
          await loadPmxFromFolder(picked.files, picked.pmxFile)
        } else {
          setPmxPickFiles(picked.files)
          setPmxPickPaths(picked.pmxRelativePaths)
          setPmxPickSelected(picked.pmxRelativePaths[0] ?? "")
        }
      } catch (err) {
        console.error("[pmx-folder]", err)
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },
    [loadPmxFromFolder],
  )

  const onConfirmPmxPick = useCallback(async () => {
    const files = pmxPickFiles
    const path = pmxPickSelected
    if (!files || !path) return
    const pmxFile = pmxFileAtRelativePath(files, path)
    if (!pmxFile) {
      window.alert("Could not find the selected PMX file.")
      return
    }
    await loadPmxFromFolder(files, pmxFile)
    setPmxPickFiles(null)
    setPmxPickPaths([])
    setPmxPickSelected("")
  }, [loadPmxFromFolder, pmxPickFiles, pmxPickSelected])

  const dismissPmxPickDialog = useCallback(() => {
    setPmxPickFiles(null)
    setPmxPickPaths([])
    setPmxPickSelected("")
  }, [])

  const pmxPickDialogOpen = Boolean(pmxPickFiles && pmxPickPaths.length > 1)

  useEffect(() => {
    if (!pmxPickDialogOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") dismissPmxPickDialog()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dismissPmxPickDialog, pmxPickDialogOpen])

  const applyPose = useCallback(
    (boneStates: BoneState[], tweenMs: number = 30) => {
      if (!engineRef.current) return
      const pose: Record<string, Quat> = {}
      const moves: Record<string, Vec3> = {}
      for (const bone of boneStates) {
        pose[bone.name] = new Quat(bone.rotation.x, bone.rotation.y, bone.rotation.z, bone.rotation.w)
        // センター and the leg IK bones carry translation — the body's height
        // over the ground and where each foot lands.
        if (bone.translation) {
          moves[bone.name] = new Vec3(bone.translation.x, bone.translation.y, bone.translation.z)
        }
      }
      if (Object.keys(pose).length > 0) {
        modelRef.current?.rotateBones(pose, tweenMs)
      }
      if (Object.keys(moves).length > 0) {
        modelRef.current?.moveBones(moves, tweenMs)
      }
    },
    [engineRef],
  )

  /**
   * Captured motion → a .vmd on disk.
   *
   * The clip goes through the model, so the ENGINE writes the file — the same
   * writer Reze Studio exports through. That is what makes a capture from here
   * open there, and in MMD, without a second VMD implementation to keep correct.
   * The clip is registered under its own name and never played, so the live pose
   * the user is still driving is untouched.
   */
  const exportVmd = useCallback((clip: AnimationClip) => {
    const model = modelRef.current
    if (!model || clip.frameCount === 0) return
    model.loadClip(EXPORT_CLIP_NAME, clip)
    const buffer = model.exportVmd(EXPORT_CLIP_NAME)
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `mikapo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.vmd`
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const resetModel = useCallback(() => {
    modelRef.current?.resetAllBones()
    modelRef.current?.resetAllMorphs()
  }, [])

  const applyFace = useCallback(
    (faceResult: FaceSolverResult, tweenMs: number = 30) => {
      if (!engineRef.current) return

      // Apply eye bone rotations (左目, 右目)
      if (faceResult.boneStates.length > 0) {
        const pose: Record<string, Quat> = {}
        for (const bone of faceResult.boneStates) {
          pose[bone.name] = new Quat(bone.rotation.x, bone.rotation.y, bone.rotation.z, bone.rotation.w)
        }
        modelRef.current?.rotateBones(pose, tweenMs)
      }

      // Morph weights are already resolved to this model's actual morph names
      // by FaceBlendshapeSolver.configure().
      for (const [name, weight] of Object.entries(faceResult.morphWeights)) {
        modelRef.current?.setMorphWeight(name, weight, tweenMs)
      }
    },
    [engineRef],
  )

  return (
    <div
      className="relative w-full h-full overflow-hidden transition-[background] duration-500 ease-out"
      style={{ background: activePreset.css }}
    >
      <input
        ref={pmxFolderInputRef}
        type="file"
        className="fixed right-0 top-0 -z-10 h-px w-px opacity-0"
        multiple
        {...pmxFolderInputAttrs}
        onChange={onPickPmxFolder}
      />

      <header className="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between gap-3 px-4 pointer-events-none">
        {/* Left brand — desktop only. Hidden on mobile (takes no width via `hidden`),
            so `justify-between` snaps the right cluster to the corner. */}
        <div className="hidden items-baseline gap-2 rounded-full border border-white/10 bg-black/40 px-3.5 py-1.5 backdrop-blur-md md:flex shadow-sm pointer-events-auto">
          <span className="text-sm font-semibold tracking-tight text-white">
            Hyatrack
          </span>
          <span className="hidden text-xs text-white/50 lg:inline">
            Real-time MMD motion capture
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 p-1 backdrop-blur-md shadow-sm pointer-events-auto">
          {/* Desktop-only cluster */}
          <div className="hidden items-center gap-1.5 md:flex">
            {stats && (
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[11px] tabular-nums text-white/70">
                {stats.fps} FPS
              </span>
            )}

            <div className="h-4 w-px bg-white/10" />

            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-8 px-2.5 text-xs font-normal text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Link href="#" target="_blank">
                  Engine
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-8 px-2.5 text-xs font-normal text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Link href="#" target="_blank">
                  Animation
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-8 px-2.5 text-xs font-normal text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Link href="#" target="_blank">
                  Design
                </Link>
              </Button>
            </div>

            <div className="h-4 w-px bg-white/10" />

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!engineInited}
              className="h-8 gap-1 border border-white/10 bg-white/10 px-2 text-xs font-normal text-white hover:bg-white/15 disabled:opacity-50 has-[>svg]:px-2"
              onClick={() => pmxFolderInputRef.current?.click()}
            >
              <FolderOpen className="size-3.5" />
              Use Your Model
            </Button>

            <div className="h-4 w-px bg-white/10" />
          </div>

          {/* Background Menu Trigger & Dropdown */}
          <div className="relative" ref={bgMenuRef}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={`h-8 gap-1.5 border border-white/10 px-2.5 text-xs font-normal text-white hover:bg-white/15 has-[>svg]:px-2 ${
                bgMenuOpen ? "bg-white/20" : "bg-white/10"
              }`}
              onClick={() => {
                setBgMenuOpen((prev) => {
                  if (!prev) setLightMenuOpen(false)
                  return !prev
                })
              }}
              aria-label="Ganti Background"
              title="Ganti Background"
            >
              <Palette className="size-3.5 text-white/90" />
              <span className="hidden sm:inline">Background</span>
            </Button>

            {bgMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-white/15 bg-zinc-950/95 p-2 text-white shadow-2xl shadow-black/60 backdrop-blur-xl z-50 animate-in fade-in-0 zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/10 mb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
                    Pilih Background
                  </span>
                  <span className="text-[10px] text-white/40">
                    {BACKGROUND_PRESETS.length} tema
                  </span>
                </div>
                <div className="space-y-1">
                  {BACKGROUND_PRESETS.map((preset) => {
                    const isSelected = preset.id === activePreset.id
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          applyBackgroundPreset(preset)
                          setBgMenuOpen(false)
                        }}
                        className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                          isSelected
                            ? "bg-white/15 text-white font-medium"
                            : "text-white/80 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="size-4 shrink-0 rounded-full border border-white/30 shadow-xs"
                            style={{ background: preset.css }}
                          />
                          <div className="truncate">
                            <div className="truncate leading-tight">
                              {preset.name}
                            </div>
                            {preset.description && (
                              <div className="text-[10px] text-white/50 leading-tight truncate">
                                {preset.description}
                              </div>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="size-3.5 shrink-0 text-white" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Lighting Menu Trigger & Popover */}
          <div className="relative" ref={lightMenuRef}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={`h-8 gap-1.5 border border-white/10 px-2.5 text-xs font-normal text-white hover:bg-white/15 has-[>svg]:px-2 ${
                lightMenuOpen ? "bg-white/20" : "bg-white/10"
              }`}
              onClick={() => {
                setLightMenuOpen((prev) => {
                  if (!prev) setBgMenuOpen(false)
                  return !prev
                })
              }}
              aria-label="Atur Pencahayaan"
              title="Atur Pencahayaan"
            >
              <SunMedium className="size-3.5 text-amber-300" />
              <span className="hidden sm:inline">Lighting</span>
            </Button>

            {lightMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-72 sm:w-80 rounded-xl border border-white/15 bg-zinc-950/95 p-3.5 text-white shadow-2xl shadow-black/60 backdrop-blur-xl z-50 animate-in fade-in-0 zoom-in-95 duration-150 space-y-3"
              >
                {/* Title & Reset Button */}
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Sun className="size-3.5 text-amber-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/80">
                      Pencahayaan
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyLighting(DEFAULT_LIGHTING)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                    title="Reset ke pengaturan default"
                  >
                    <RotateCcw className="size-3" />
                    <span>Reset</span>
                  </button>
                </div>

                {/* Tab Switcher: Intensitas vs Arah */}
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-0.5 border border-white/10 text-xs">
                  <button
                    type="button"
                    onClick={() => setLightingTab("intensity")}
                    className={`flex items-center justify-center gap-1.5 rounded-md py-1 font-medium transition-colors ${
                      lightingTab === "intensity"
                        ? "bg-white/15 text-white shadow-xs"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    <SunMedium className="size-3.5 text-amber-300" />
                    <span>Intensitas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightingTab("direction")}
                    className={`flex items-center justify-center gap-1.5 rounded-md py-1 font-medium transition-colors ${
                      lightingTab === "direction"
                        ? "bg-white/15 text-white shadow-xs"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    <Compass className="size-3.5 text-sky-300" />
                    <span>Arah Cahaya</span>
                  </button>
                </div>

                {lightingTab === "intensity" ? (
                  <>
                    {/* Preset Chips */}
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5">
                        Preset Cepat
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {LIGHTING_PRESETS.map((p) => {
                          const isMatch =
                            Math.abs(lighting.exposure - p.settings.exposure) <
                              0.05 &&
                            Math.abs(
                              lighting.sunStrength - p.settings.sunStrength,
                            ) < 0.1 &&
                            Math.abs(
                              lighting.worldStrength - p.settings.worldStrength,
                            ) < 0.05 &&
                            lighting.sunColor === p.settings.sunColor
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => applyLighting(p.settings)}
                              className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors ${
                                isMatch
                                  ? "bg-amber-400/20 text-amber-300 font-medium border border-amber-400/40"
                                  : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/5"
                              }`}
                            >
                              {p.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Sliders */}
                    <div className="space-y-2.5 pt-1 border-t border-white/10">
                      {/* Exposure / Brightness */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/80">
                            Kecerahan (Exposure)
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-white/60">
                            {lighting.exposure > 0
                              ? `+${lighting.exposure.toFixed(2)}`
                              : lighting.exposure.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-1.5}
                          max={2.0}
                          step={0.05}
                          value={lighting.exposure}
                          onChange={(e) =>
                            updateLightingField(
                              "exposure",
                              parseFloat(e.target.value),
                            )
                          }
                          className="w-full h-1.5 cursor-pointer appearance-none rounded-full bg-white/20 accent-amber-400 outline-none"
                        />
                      </div>

                      {/* Sun Light (Main Key Light) */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/80">
                            Lampu Utama (Sun)
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-white/60">
                            {lighting.sunStrength.toFixed(1)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.0}
                          max={4.5}
                          step={0.1}
                          value={lighting.sunStrength}
                          onChange={(e) =>
                            updateLightingField(
                              "sunStrength",
                              parseFloat(e.target.value),
                            )
                          }
                          className="w-full h-1.5 cursor-pointer appearance-none rounded-full bg-white/20 accent-amber-400 outline-none"
                        />
                      </div>

                      {/* Ambient / World (Fill Light) */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/80">Cahaya Ambient</span>
                          <span className="font-mono text-[11px] tabular-nums text-white/60">
                            {lighting.worldStrength.toFixed(2)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.0}
                          max={1.5}
                          step={0.05}
                          value={lighting.worldStrength}
                          onChange={(e) =>
                            updateLightingField(
                              "worldStrength",
                              parseFloat(e.target.value),
                            )
                          }
                          className="w-full h-1.5 cursor-pointer appearance-none rounded-full bg-white/20 accent-amber-400 outline-none"
                        />
                      </div>

                      {/* Bloom (Glow) */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/80">Glow / Bloom</span>
                          <span className="font-mono text-[11px] tabular-nums text-white/60">
                            {Math.round(lighting.bloomIntensity * 1000)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.0}
                          max={0.12}
                          step={0.005}
                          value={lighting.bloomIntensity}
                          onChange={(e) =>
                            updateLightingField(
                              "bloomIntensity",
                              parseFloat(e.target.value),
                            )
                          }
                          className="w-full h-1.5 cursor-pointer appearance-none rounded-full bg-white/20 accent-amber-400 outline-none"
                        />
                      </div>

                      {/* Tint Color Picker */}
                      <div className="pt-1 flex items-center justify-between">
                        <span className="text-xs text-white/80">
                          Warna Cahaya
                        </span>
                        <div className="flex items-center gap-1.5">
                          {[
                            {
                              label: "Netral",
                              color: "#ffffff",
                              border: "border-white/60",
                            },
                            {
                              label: "Hangat",
                              color: "#ffe0b2",
                              border: "border-amber-300",
                            },
                            {
                              label: "Sejuk",
                              color: "#b3e5fc",
                              border: "border-sky-300",
                            },
                            {
                              label: "Pink",
                              color: "#f8bbd0",
                              border: "border-pink-300",
                            },
                          ].map((t) => (
                            <button
                              key={t.color}
                              type="button"
                              onClick={() =>
                                updateLightingField("sunColor", t.color)
                              }
                              title={t.label}
                              className={`size-5 rounded-full border-2 transition-transform ${
                                lighting.sunColor.toLowerCase() ===
                                t.color.toLowerCase()
                                  ? `${t.border} scale-110 shadow-sm ring-1 ring-white/50`
                                  : "border-transparent opacity-70 hover:opacity-100"
                              }`}
                              style={{ backgroundColor: t.color }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Visual Compass Radar */}
                    <div className="flex items-center gap-3 bg-white/5 rounded-lg p-2.5 border border-white/10">
                      <div className="relative size-20 shrink-0 rounded-full border border-white/20 bg-black/50 flex items-center justify-center shadow-inner select-none">
                        {/* Crosshairs */}
                        <div className="absolute inset-x-2 top-1/2 h-px bg-white/15 -translate-y-1/2 pointer-events-none" />
                        <div className="absolute inset-y-2 left-1/2 w-px bg-white/15 -translate-x-1/2 pointer-events-none" />
                        {/* Model marker in center */}
                        <div
                          className="size-2 rounded-full bg-white/60 ring-2 ring-white/15"
                          title="Posisi Karakter"
                        />
                        {/* Cardinal markers */}
                        <span className="absolute top-1 text-[8px] font-bold text-white/40">
                          D
                        </span>
                        <span className="absolute bottom-1 text-[8px] font-bold text-white/40">
                          B
                        </span>
                        <span className="absolute right-1.5 text-[8px] font-bold text-white/40">
                          R
                        </span>
                        <span className="absolute left-1.5 text-[8px] font-bold text-white/40">
                          L
                        </span>
                        {/* Sun position indicator */}
                        {(() => {
                          const rad =
                            ((lighting.sunAzimuth - 90) * Math.PI) / 180
                          const cx = 40 + 27 * Math.cos(rad)
                          const cy = 40 + 27 * Math.sin(rad)
                          return (
                            <div
                              className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 text-zinc-950 flex items-center justify-center shadow-md shadow-amber-400/50 transition-all duration-75"
                              style={{ left: `${cx}px`, top: `${cy}px` }}
                              title={`Matahari: ${lighting.sunAzimuth}°`}
                            >
                              <Sun
                                className="size-2.5 animate-spin"
                                style={{ animationDuration: "12s" }}
                              />
                            </div>
                          )
                        })()}
                      </div>

                      {/* Direction labels & description */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-[10px] uppercase font-semibold tracking-wider text-white/40">
                          Posisi Matahari
                        </div>
                        <div className="text-xs font-semibold text-sky-300">
                          {getAzimuthLabel(lighting.sunAzimuth)}
                        </div>
                        <div className="text-[10px] text-white/60 space-x-1 font-mono">
                          <span>
                            Azimuth:{" "}
                            {lighting.sunAzimuth > 0
                              ? `+${lighting.sunAzimuth}`
                              : lighting.sunAzimuth}
                            °
                          </span>
                          <span>•</span>
                          <span>Elevasi: {lighting.sunElevation}°</span>
                        </div>
                      </div>
                    </div>

                    {/* Direction Presets */}
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5">
                        Preset Arah
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {DIRECTION_PRESETS.map((dp) => {
                          const isMatch =
                            Math.abs(lighting.sunAzimuth - dp.azimuth) <= 5 &&
                            Math.abs(lighting.sunElevation - dp.elevation) <= 5
                          return (
                            <button
                              key={dp.id}
                              type="button"
                              onClick={() =>
                                applyLighting({
                                  ...lighting,
                                  sunAzimuth: dp.azimuth,
                                  sunElevation: dp.elevation,
                                })
                              }
                              className={`flex items-center justify-center rounded-md px-1.5 py-1 text-[11px] transition-colors ${
                                isMatch
                                  ? "bg-sky-400/20 text-sky-300 font-medium border border-sky-400/40"
                                  : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/5"
                              }`}
                            >
                              {dp.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Direction Sliders */}
                    <div className="space-y-2.5 pt-1 border-t border-white/10">
                      {/* Horizontal Azimuth */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/80">
                            Rotasi Horizontal
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-white/60">
                            {lighting.sunAzimuth > 0
                              ? `+${lighting.sunAzimuth}`
                              : lighting.sunAzimuth}
                            °
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={5}
                          value={lighting.sunAzimuth}
                          onChange={(e) =>
                            updateLightingField(
                              "sunAzimuth",
                              parseInt(e.target.value, 10),
                            )
                          }
                          className="w-full h-1.5 cursor-pointer appearance-none rounded-full bg-white/20 accent-sky-400 outline-none"
                        />
                        <div className="flex justify-between text-[9px] text-white/35 font-mono">
                          <span>-180° (Kiri)</span>
                          <span>0° (Depan)</span>
                          <span>+180° (Kanan)</span>
                        </div>
                      </div>

                      {/* Vertical Elevation */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/80">
                            Ketinggian (Elevasi)
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-white/60">
                            {lighting.sunElevation}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={85}
                          step={5}
                          value={lighting.sunElevation}
                          onChange={(e) =>
                            updateLightingField(
                              "sunElevation",
                              parseInt(e.target.value, 10),
                            )
                          }
                          className="w-full h-1.5 cursor-pointer appearance-none rounded-full bg-white/20 accent-sky-400 outline-none"
                        />
                        <div className="flex justify-between text-[9px] text-white/35 font-mono">
                          <span>10° (Rendah)</span>
                          <span>45° (Normal)</span>
                          <span>85° (Zenith/Atas)</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Mobile-only brand */}
          <span className="text-sm font-semibold tracking-tight text-white md:hidden px-1.5">
            MiKaPo
          </span>

          {/* GitHub icon */}
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="size-8 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Link
              href="https://github.com/Hyadawild"
              target="_blank"
              aria-label="GitHub"
            >
              <Github className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      {pmxPickDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Dismiss"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={dismissPmxPickDialog}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pmx-picker-title"
            className="relative z-[1] w-full max-w-md rounded-xl border border-white/10 bg-zinc-950/85 p-5 text-white shadow-2xl shadow-black/50 backdrop-blur-xl"
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2
                id="pmx-picker-title"
                className="text-sm font-semibold tracking-tight"
              >
                Multiple .pmx files in folder
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-mr-1 -mt-1 size-7 shrink-0 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Close"
                onClick={dismissPmxPickDialog}
              >
                <X className="size-4" />
              </Button>
            </div>
            <p className="mb-4 text-xs text-white/60">
              Pick which model to load.
            </p>
            <select
              className="mb-5 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none focus-visible:border-white/30 focus-visible:ring-2 focus-visible:ring-white/20"
              value={pmxPickSelected}
              onChange={(ev) => setPmxPickSelected(ev.target.value)}
            >
              {pmxPickPaths.map((p) => (
                <option key={p} value={p} className="bg-zinc-900 text-white">
                  {p}
                </option>
              ))}
            </select>
            <div className="flex flex-row justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                onClick={dismissPmxPickDialog}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 bg-white text-xs text-black hover:bg-white/90"
                onClick={() => void onConfirmPmxPick()}
              >
                Load selected
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <MotionCapture
        applyPose={applyPose}
        applyFace={applyFace}
        modelLoaded={modelLoaded}
        onMediaPipeReadyChange={setMediaPipeReady}
        resetModel={resetModel}
        restPose={restPose}
        colliders={colliders}
        modelMorphs={modelMorphs}
        exportVmd={exportVmd}
      />

      {/* One message at a time. A failed boot leaves `modelLoaded` false, so the
          loader kept counting dots underneath the error that explained why it
          never would finish — two centred overlays, both unreadable. */}
      {engineError ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-red-400/20 bg-zinc-950/90 px-5 py-4 text-center text-sm leading-relaxed text-red-300 shadow-2xl shadow-black/40 backdrop-blur-md">
            {engineError}
          </div>
        </div>
      ) : (
        <Loading modelLoaded={modelLoaded} mediaPipeReady={mediaPipeReady} />
      )}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full z-1 outline-none"
      />
    </div>
  )
}
