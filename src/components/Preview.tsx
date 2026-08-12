import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { LibraryFile } from '../lib/library'

const thumbnailCache = new Map<string, string>()

async function loadGeometry(handle: FileSystemFileHandle) {
  // Deliberately invoke getFile on its owning handle; do not destructure it.
  const file = await handle.getFile()
  const buffer = await file.arrayBuffer()
  const geometry = new STLLoader().parse(buffer)
  geometry.computeVertexNormals()
  geometry.center()
  geometry.computeBoundingBox()
  return geometry
}

function fitCamera(camera: THREE.PerspectiveCamera, geometry: THREE.BufferGeometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox ?? new THREE.Box3()
  const size = new THREE.Vector3()
  box.getSize(size)
  const maxDimension = Math.max(size.x, size.y, size.z, 1)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.65

  camera.up.set(0, 0, 1)
  camera.position.set(distance * 0.9, -distance * 1.05, distance * 0.72)
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(distance * 50, 1000)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 2.6))
  const key = new THREE.DirectionalLight(0xffffff, 3.4)
  key.position.set(4, -3, 7)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xb8c8ff, 1.6)
  fill.position.set(-5, 2, 3)
  scene.add(fill)
}

export function ImagePreview({ file }: { file: LibraryFile }) {
  const [src, setSrc] = useState<string>()

  useEffect(() => {
    let url: string | undefined
    let cancelled = false

    file.handle
      .getFile()
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => setSrc(undefined))

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  return src ? <img className="cover-image" src={src} alt="" /> : <PreviewFallback label="Image unavailable" />
}

export function StlThumbnail({ file }: { file: LibraryFile }) {
  const [src, setSrc] = useState<string | undefined>(() => thumbnailCache.get(file.id))

  useEffect(() => {
    if (src) return
    let cancelled = false

    const render = async () => {
      const geometry = await loadGeometry(file.handle)
      const canvas = document.createElement('canvas')
      canvas.width = 560
      canvas.height = 400

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
      renderer.setPixelRatio(1)
      renderer.setSize(canvas.width, canvas.height, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.01, 10000)
      fitCamera(camera, geometry)
      addLights(scene)

      const material = new THREE.MeshStandardMaterial({
        color: 0xd7dde7,
        roughness: 0.66,
        metalness: 0.04,
      })
      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)
      renderer.render(scene, camera)

      const dataUrl = canvas.toDataURL('image/webp', 0.86)
      thumbnailCache.set(file.id, dataUrl)

      geometry.dispose()
      material.dispose()
      renderer.dispose()

      if (!cancelled) setSrc(dataUrl)
    }

    render().catch((error) => {
      console.warn(`Preview unavailable for ${file.relativePath}`, error)
      if (!cancelled) setSrc(undefined)
    })

    return () => {
      cancelled = true
    }
  }, [file, src])

  return src ? <img className="cover-image" src={src} alt="" /> : <PreviewFallback label="Generating STL preview…" />
}

export function StlViewer({ file, showReset = false }: { file: LibraryFile; showReset?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const resetViewRef = useRef<() => void>(() => undefined)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let animationFrame = 0
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let geometry: THREE.BufferGeometry | undefined
    let material: THREE.MeshStandardMaterial | undefined
    let observer: ResizeObserver | undefined

    const initialise = async () => {
      geometry = await loadGeometry(file.handle)
      if (disposed) {
        geometry.dispose()
        return
      }

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0e1015)
      const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000)
      fitCamera(camera, geometry)
      addLights(scene)

      material = new THREE.MeshStandardMaterial({
        color: 0xe0e5ed,
        roughness: 0.62,
        metalness: 0.06,
      })
      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)

      const canvas = document.createElement('canvas')
      canvas.className = 'viewer-canvas'
      host.replaceChildren(canvas)

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace

      controls = new OrbitControls(camera, canvas)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.target.set(0, 0, 0)
      controls.update()

      resetViewRef.current = () => {
        if (!geometry || !controls) return
        fitCamera(camera, geometry)
        controls.target.set(0, 0, 0)
        controls.update()
      }

      const resize = () => {
        if (!renderer) return
        const width = Math.max(host.clientWidth, 1)
        const height = Math.max(host.clientHeight, 1)
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }

      observer = new ResizeObserver(resize)
      observer.observe(host)
      resize()

      const animate = () => {
        if (disposed || !renderer || !controls) return
        controls.update()
        renderer.render(scene, camera)
        animationFrame = requestAnimationFrame(animate)
      }
      animate()
    }

    setError(undefined)
    initialise().catch((err) => {
      console.error(err)
      if (!disposed) setError('Preview unavailable for this STL.')
    })

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      observer?.disconnect()
      controls?.dispose()
      geometry?.dispose()
      material?.dispose()
      renderer?.dispose()
      resetViewRef.current = () => undefined
      host.replaceChildren()
    }
  }, [file])

  return (
    <div className="viewer-shell">
      <div ref={hostRef} className="viewer-host" />
      {error && <div className="viewer-error">{error}</div>}
      {!error && <div className="viewer-hint">Drag to rotate · wheel to zoom · right-drag to pan</div>}
      {showReset && !error && (
        <button type="button" className="viewer-reset-button" onClick={() => resetViewRef.current()}>
          Reset view
        </button>
      )}
    </div>
  )
}

export function PreviewFallback({ label = 'No preview' }: { label?: string }) {
  return (
    <div className="preview-fallback">
      <div className="fallback-cube" aria-hidden="true">◇</div>
      <span>{label}</span>
    </div>
  )
}
