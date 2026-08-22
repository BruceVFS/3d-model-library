import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { strFromU8, unzipSync } from 'fflate'
import type { LibraryFile } from '../lib/library'
import { isDesktopApp, readDesktopFile } from '../lib/platform'

const thumbnailCache = new Map<string, string>()

function previewCacheKey(file: LibraryFile) {
  return `${file.nativePath ?? file.id}:${file.size}:${file.lastModified}`
}

async function readLibraryFile(file: LibraryFile): Promise<ArrayBuffer> {
  if (file.nativePath && isDesktopApp()) {
    return readDesktopFile(file.nativePath)
  }

  if (!file.handle) throw new Error('No readable file source is available.')

  // Deliberately invoke getFile on its owning handle; do not destructure it.
  const browserFile = await file.handle.getFile()
  return browserFile.arrayBuffer()
}

async function loadGeometry(file: LibraryFile) {
  const buffer = await readLibraryFile(file)
  const geometry = new STLLoader().parse(buffer)
  geometry.computeVertexNormals()
  geometry.center()
  geometry.computeBoundingBox()
  return geometry
}

function imageMimeType(file: LibraryFile) {
  if (file.extension === 'jpg' || file.extension === 'jpeg') return 'image/jpeg'
  return `image/${file.extension}`
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

    readLibraryFile(file)
      .then((buffer) => {
        if (cancelled) return
        const blob = new Blob([buffer], { type: imageMimeType(file) })
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
  const cacheKey = previewCacheKey(file)
  const [src, setSrc] = useState<string | undefined>(() => thumbnailCache.get(cacheKey))

  useEffect(() => {
    if (src) return
    let cancelled = false

    const render = async () => {
      const geometry = await loadGeometry(file)
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
      thumbnailCache.set(cacheKey, dataUrl)

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
  }, [cacheKey, file, src])

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
      geometry = await loadGeometry(file)
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



const THREE_MF_PRODUCTION_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'

function normaliseThreeMfPartPath(value: string) {
  let decoded = value.trim().replace(/\\/g, '/')
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // Keep the original path if it contains malformed URI escapes.
  }
  return decoded.replace(/^\/+/, '').replace(/\/+/g, '/')
}

function xmlAttributeByLocalName(element: Element, localName: string) {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === localName) return attribute.value
  }
  return undefined
}

function directXmlChild(parent: Element, localName: string) {
  return Array.from(parent.children).find((child) => child.localName === localName)
}

function directXmlChildren(parent: Element, localName: string) {
  return Array.from(parent.children).filter((child) => child.localName === localName)
}

function parseThreeMfXml(bytes: Uint8Array, partPath: string) {
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  const parserError = document.querySelector('parsererror')
  if (parserError) throw new Error(`Invalid XML in 3MF part ${partPath}.`)
  return document
}

function unitScaleToMillimetres(model: Element) {
  switch ((model.getAttribute('unit') ?? 'millimeter').toLowerCase()) {
    case 'micron':
      return 0.001
    case 'centimeter':
      return 10
    case 'inch':
      return 25.4
    case 'foot':
      return 304.8
    case 'meter':
      return 1000
    case 'millimeter':
    default:
      return 1
  }
}

function threeMfTransform(value: string | undefined, translationScale: number) {
  const matrix = new THREE.Matrix4()
  if (!value) return matrix.identity()

  const values = value.trim().split(/\s+/).map(Number)
  if (values.length !== 12 || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error('Invalid 3MF transform.')
  }

  matrix.set(
    values[0], values[3], values[6], values[9] * translationScale,
    values[1], values[4], values[7], values[10] * translationScale,
    values[2], values[5], values[8], values[11] * translationScale,
    0, 0, 0, 1,
  )
  return matrix
}

function productionMeshFromObject(objectElement: Element, modelUnitScale: number) {
  const mesh = directXmlChild(objectElement, 'mesh')
  if (!mesh) throw new Error('3MF object has neither a mesh nor components.')

  const verticesElement = directXmlChild(mesh, 'vertices')
  const trianglesElement = directXmlChild(mesh, 'triangles')
  if (!verticesElement || !trianglesElement) throw new Error('3MF mesh is incomplete.')

  const positions: number[] = []
  for (const vertex of directXmlChildren(verticesElement, 'vertex')) {
    const x = Number(vertex.getAttribute('x'))
    const y = Number(vertex.getAttribute('y'))
    const z = Number(vertex.getAttribute('z'))
    if (![x, y, z].every(Number.isFinite)) throw new Error('3MF contains an invalid vertex.')
    positions.push(x * modelUnitScale, y * modelUnitScale, z * modelUnitScale)
  }

  const indices: number[] = []
  for (const triangle of directXmlChildren(trianglesElement, 'triangle')) {
    const v1 = Number(triangle.getAttribute('v1'))
    const v2 = Number(triangle.getAttribute('v2'))
    const v3 = Number(triangle.getAttribute('v3'))
    if (![v1, v2, v3].every(Number.isInteger)) throw new Error('3MF contains an invalid triangle.')
    indices.push(v1, v2, v3)
  }

  if (!positions.length || !indices.length) throw new Error('3MF mesh contains no geometry.')

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    color: 0xe0e5ed,
    roughness: 0.62,
    metalness: 0.06,
  })

  const meshObject = new THREE.Mesh(geometry, material)
  const name = objectElement.getAttribute('name')
  if (name) meshObject.name = name
  return meshObject
}

function parseProductionThreeMf(buffer: ArrayBuffer) {
  const rawEntries = unzipSync(new Uint8Array(buffer))
  const entries = new Map<string, Uint8Array>()

  for (const [entryPath, bytes] of Object.entries(rawEntries)) {
    entries.set(normaliseThreeMfPartPath(entryPath).toLowerCase(), bytes)
  }

  const findPart = (partPath: string) => {
    const normalised = normaliseThreeMfPartPath(partPath)
    const bytes = entries.get(normalised.toLowerCase())
    if (!bytes) throw new Error(`Referenced 3MF model part not found: ${normalised}`)
    return { path: normalised, bytes }
  }

  let rootModelPath = '3D/3dmodel.model'
  const packageRels = entries.get('_rels/.rels')
  if (packageRels) {
    const relationships = parseThreeMfXml(packageRels, '_rels/.rels')
    const modelRelationship = Array.from(relationships.getElementsByTagNameNS('*', 'Relationship')).find((relationship) =>
      (relationship.getAttribute('Type') ?? '').toLowerCase().includes('3dmodel'),
    )
    const target = modelRelationship?.getAttribute('Target')
    if (target) rootModelPath = normaliseThreeMfPartPath(target)
  }

  const modelDocuments = new Map<string, XMLDocument>()
  const getModelDocument = (partPath: string) => {
    const part = findPart(partPath)
    const key = part.path.toLowerCase()
    let document = modelDocuments.get(key)
    if (!document) {
      document = parseThreeMfXml(part.bytes, part.path)
      modelDocuments.set(key, document)
    }
    return { partPath: part.path, document }
  }

  const objectCache = new Map<string, THREE.Object3D>()

  const buildObject = (partPath: string, objectId: string, active: Set<string>): THREE.Object3D => {
    const modelInfo = getModelDocument(partPath)
    const model = modelInfo.document.documentElement
    const cacheKey = `${modelInfo.partPath.toLowerCase()}#${objectId}`

    const cached = objectCache.get(cacheKey)
    if (cached) return cached.clone(true)

    if (active.has(cacheKey)) throw new Error('Circular 3MF component reference detected.')
    const nextActive = new Set(active)
    nextActive.add(cacheKey)

    const resources = directXmlChild(model, 'resources')
    if (!resources) throw new Error(`3MF model part has no resources: ${modelInfo.partPath}`)

    const objectElement = directXmlChildren(resources, 'object').find((candidate) => candidate.getAttribute('id') === objectId)
    if (!objectElement) {
      throw new Error(`3MF object ${objectId} was not found in ${modelInfo.partPath}.`)
    }

    const unitScale = unitScaleToMillimetres(model)
    let result: THREE.Object3D

    if (directXmlChild(objectElement, 'mesh')) {
      result = productionMeshFromObject(objectElement, unitScale)
    } else {
      const components = directXmlChild(objectElement, 'components')
      if (!components) throw new Error(`3MF object ${objectId} has neither mesh nor components.`)

      const group = new THREE.Group()
      for (const component of directXmlChildren(components, 'component')) {
        const referencedId = component.getAttribute('objectid')
        if (!referencedId) throw new Error('3MF component is missing objectid.')

        const productionPath =
          component.getAttributeNS(THREE_MF_PRODUCTION_NAMESPACE, 'path') ??
          xmlAttributeByLocalName(component, 'path')

        const referencedPath = productionPath
          ? normaliseThreeMfPartPath(productionPath)
          : modelInfo.partPath

        const child = buildObject(referencedPath, referencedId, nextActive)
        const transform = xmlAttributeByLocalName(component, 'transform')
        child.applyMatrix4(threeMfTransform(transform, unitScale))
        group.add(child)
      }
      result = group
    }

    const objectName = objectElement.getAttribute('name')
    if (objectName) result.name = objectName
    objectCache.set(cacheKey, result)
    return result.clone(true)
  }

  const rootInfo = getModelDocument(rootModelPath)
  const rootModel = rootInfo.document.documentElement
  const rootScale = unitScaleToMillimetres(rootModel)
  const build = directXmlChild(rootModel, 'build')
  if (!build) throw new Error('3MF root model has no build section.')

  const result = new THREE.Group()
  for (const item of directXmlChildren(build, 'item')) {
    const objectId = item.getAttribute('objectid')
    if (!objectId) continue

    const productionPath =
      item.getAttributeNS(THREE_MF_PRODUCTION_NAMESPACE, 'path') ??
      xmlAttributeByLocalName(item, 'path')

    const itemPath = productionPath
      ? normaliseThreeMfPartPath(productionPath)
      : rootInfo.partPath

    const object = buildObject(itemPath, objectId, new Set())
    const transform = xmlAttributeByLocalName(item, 'transform')
    object.applyMatrix4(threeMfTransform(transform, rootScale))
    result.add(object)
  }

  let meshCount = 0
  result.traverse((child) => {
    if (child instanceof THREE.Mesh) meshCount += 1
  })
  if (!meshCount) throw new Error('3MF build contains no renderable meshes.')

  return result
}

function loadThreeMfObject(buffer: ArrayBuffer) {
  try {
    return new ThreeMFLoader().parse(buffer)
  } catch (threeJsError) {
    console.warn('Three.js 3MF loader could not resolve this file; trying Production Extension fallback.', threeJsError)
    return parseProductionThreeMf(buffer)
  }
}

function fitCameraToObject(camera: THREE.PerspectiveCamera, object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) throw new Error('3MF contains no renderable geometry.')

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

function centreObject(object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) throw new Error('3MF contains no renderable geometry.')

  const centre = new THREE.Vector3()
  box.getCenter(centre)
  object.position.sub(centre)
  object.updateMatrixWorld(true)
}

function disposeThreeMfObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    child.geometry?.dispose()

    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

export function ThreeMfViewer({ file, showReset = false }: { file: LibraryFile; showReset?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const resetViewRef = useRef<() => void>(() => undefined)
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let animationFrame = 0
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let model: THREE.Group | undefined
    let observer: ResizeObserver | undefined

    const initialise = async () => {
      const buffer = await readLibraryFile(file)
      model = loadThreeMfObject(buffer)
      centreObject(model)

      if (disposed) {
        disposeThreeMfObject(model)
        return
      }

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0e1015)

      const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000)
      fitCameraToObject(camera, model)
      addLights(scene)
      scene.add(model)

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
        if (!model || !controls) return
        fitCameraToObject(camera, model)
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
      setIsLoading(false)
    }

    setError(undefined)
    setIsLoading(true)
    initialise().catch((err) => {
      console.error(err)
      if (!disposed) {
        setIsLoading(false)
        setError('Preview unavailable for this 3MF.')
      }
    })

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      observer?.disconnect()
      controls?.dispose()
      if (model) disposeThreeMfObject(model)
      renderer?.dispose()
      resetViewRef.current = () => undefined
      host.replaceChildren()
    }
  }, [file])

  return (
    <div className="viewer-shell">
      <div ref={hostRef} className="viewer-host" />
      {isLoading && !error && (
        <div className="three-mf-loading" role="status" aria-live="polite">
          <span className="three-mf-loading-spinner" aria-hidden="true" />
          <div>
            <strong>Loading 3MF…</strong>
            <span>Large or multi-plate files may take a moment.</span>
          </div>
        </div>
      )}
      {error && <div className="viewer-error">{error}</div>}
      {!error && <div className="viewer-hint">3MF · drag to rotate · wheel to zoom · right-drag to pan</div>}
      {showReset && !error && (
        <button type="button" className="viewer-reset-button" onClick={() => resetViewRef.current()}>
          Reset view
        </button>
      )}
    </div>
  )
}


export function ThreeMfThumbnail({ file }: { file: LibraryFile }) {
  const cacheKey = previewCacheKey(file)
  const [src, setSrc] = useState<string | undefined>(() => thumbnailCache.get(cacheKey))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (src) return

    let cancelled = false

    const render = async () => {
      const buffer = await readLibraryFile(file)
      const model = loadThreeMfObject(buffer)
      centreObject(model)

      const canvas = document.createElement('canvas')
      canvas.width = 560
      canvas.height = 400

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      })
      renderer.setPixelRatio(1)
      renderer.setSize(canvas.width, canvas.height, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.01, 10000)
      fitCameraToObject(camera, model)
      addLights(scene)
      scene.add(model)

      renderer.render(scene, camera)

      const dataUrl = canvas.toDataURL('image/webp', 0.86)
      thumbnailCache.set(cacheKey, dataUrl)

      scene.remove(model)
      disposeThreeMfObject(model)
      renderer.dispose()

      if (!cancelled) {
        setFailed(false)
        setSrc(dataUrl)
      }
    }

    setFailed(false)
    render().catch((error) => {
      console.warn(`3MF thumbnail unavailable for ${file.relativePath}`, error)
      if (!cancelled) {
        setFailed(true)
        setSrc(undefined)
      }
    })

    return () => {
      cancelled = true
    }
  }, [cacheKey, file, src])

  if (src) return <img className="cover-image" src={src} alt="" />
  if (failed) return <PreviewFallback label="3MF preview unavailable" />
  return <PreviewFallback label="Generating 3MF preview…" />
}

export function PreviewFallback({ label = 'No preview' }: { label?: string }) {
  return (
    <div className="preview-fallback">
      <div className="fallback-cube" aria-hidden="true">◇</div>
      <span>{label}</span>
    </div>
  )
}
