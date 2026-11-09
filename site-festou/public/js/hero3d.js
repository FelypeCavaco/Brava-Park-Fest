// Festou · cena 3D do topo: balões brilhantes (um com o "check" da marca) e
// confete caindo. Reage ao mouse e à rolagem. Sem WebGL ou com "reduzir
// movimento", fica só o fundo em gradiente.
import * as THREE from '../vendor/three.module.min.js'

const canvas = document.getElementById('hero3d')
const hero = document.querySelector('.hero')
const calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const celular = window.matchMedia('(max-width: 900px)').matches

function iniciar() {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch (e) {
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, celular ? 1.5 : 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const cena = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  camera.position.set(0, 0, 16)

  // ambiente para os reflexos (uma "sala" com painéis de luz)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const sala = new THREE.Scene()
  sala.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: 0x2a1a4e, side: THREE.BackSide })))
  const painel = (cor, x, y, z, w, h, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: cor, side: THREE.DoubleSide }))
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); sala.add(m)
  }
  painel(0xffffff, 0, 12, 0, 18, 8, 0, Math.PI / 2)
  painel(0xffffff, -12, 3, 4, 6, 10, Math.PI / 2)
  painel(0xb58cf0, 12, 0, -2, 8, 12, -Math.PI / 2)
  painel(0x4fab7c, 0, -6, 12, 14, 4, Math.PI)
  cena.environment = pmrem.fromScene(sala, 0.03).texture

  cena.add(new THREE.HemisphereLight(0xe8dcff, 0x1b1033, 0.7))
  const sol = new THREE.DirectionalLight(0xffffff, 2.2)
  sol.position.set(-5, 8, 10)
  cena.add(sol)
  const recorte = new THREE.PointLight(0x7ee0a9, 40, 30)
  recorte.position.set(6, -4, 4)
  cena.add(recorte)

  // forma do balão (gota arredondada) girada em torno do eixo
  const perfil = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const a = t * Math.PI
    const y = -Math.cos(a) * 1.18
    const r = Math.sin(a) * (0.82 + 0.2 * t) * (t < 0.12 ? 0.6 + t * 3.3 : 1)
    perfil.push(new THREE.Vector2(Math.max(r, 0.001), y))
  }
  const geoBalao = new THREE.LatheGeometry(perfil, 64)
  const geoNo = new THREE.ConeGeometry(0.11, 0.18, 16)

  const cores = [0x6a2bb5, 0x4fab7c, 0xb58cf0, 0xf4eefa, 0x59239b, 0x7ee0a9, 0xffc94d]
  const material = (cor) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.18, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), envMapIntensity: 1.1 })

  function balao(cor, escala, comCheck = false) {
    const g = new THREE.Group()
    const mat = material(cor)
    const corpo = new THREE.Mesh(geoBalao, mat)
    g.add(corpo)
    const no = new THREE.Mesh(geoNo, mat)
    no.position.y = -1.24
    no.rotation.x = Math.PI
    g.add(no)
    // barbante
    const pts = []
    for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(new THREE.Vector3(Math.sin(t * 5) * 0.12 * t, -1.32 - t * 2.6, Math.cos(t * 4) * 0.08 * t)) }
    const fio = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }))
    g.add(fio)
    if (comCheck) {
      const curva = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.42, 0.02, 0), new THREE.Vector3(-0.12, -0.28, 0), new THREE.Vector3(0.48, 0.36, 0)], false, 'catmullrom', 0)
      const check = new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.085, 12, false), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }))
      check.position.z = 0.9
      g.add(check)
      const ponta = (p) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), check.material); s.position.copy(p).setZ(0.9); g.add(s) }
      ponta(curva.points[0]); ponta(curva.points[2])
    }
    g.scale.setScalar(escala)
    return g
  }

  // posições: à direita no computador (o texto fica à esquerda); espalhados no celular
  const lugares = celular
    ? [[2.4, 3.6, 0, 0.9, 1, true], [-2.6, 4.6, -3, 0.7, 2], [3.2, -4.6, -2, 0.75, 0], [-3.2, -3.4, -4, 0.6, 3], [0.6, 6.2, -6, 0.55, 5]]
    : [[5.2, 0.6, 0, 1.55, 1, true], [8.4, 2.8, -3, 1.05, 0], [4.4, 4.2, -6, 0.85, 2], [9.2, -2.6, -2, 1.0, 3], [4.2, -3.6, -3, 0.85, 4], [11.4, 0.6, -7, 0.9, 5], [7.4, 5.6, -10, 0.8, 6], [7.2, -5.8, -8, 0.8, 2]]
  const baloes = lugares.map(([x, y, z, s, c, check], i) => {
    const b = balao(cores[c], s, !!check)
    b.position.set(x, y, z)
    b.userData = { base: new THREE.Vector3(x, y, z), fase: i * 1.7, vel: 0.5 + (i % 3) * 0.15, giro: (i % 2 ? 1 : -1) * 0.25 }
    cena.add(b)
    return b
  })

  // confete
  const N = celular ? 90 : 220
  const confete = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2 }), N)
  const dados = []
  const tmp = new THREE.Object3D()
  const corConfete = [0x4fab7c, 0xb58cf0, 0xffc94d, 0xffffff, 0x7ee0a9, 0xf28b82]
  for (let i = 0; i < N; i++) {
    dados.push({ x: (Math.random() - 0.3) * 26, y: Math.random() * 16 - 8, z: -Math.random() * 10, v: 0.25 + Math.random() * 0.6, rx: Math.random() * 6, ry: Math.random() * 6, vr: (Math.random() - 0.5) * 4, d: Math.random() * 6 })
    confete.setColorAt(i, new THREE.Color(corConfete[i % corConfete.length]))
  }
  cena.add(confete)

  // mouse e rolagem
  const mouse = { x: 0, y: 0, ax: 0, ay: 0 }
  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX / window.innerWidth - 0.5; mouse.y = e.clientY / window.innerHeight - 0.5 }, { passive: true })
  let rolagem = 0
  window.addEventListener('scroll', () => { rolagem = Math.min(1.2, window.scrollY / Math.max(hero.offsetHeight, 1)) }, { passive: true })

  function tamanho() {
    const w = hero.clientWidth, h = hero.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', tamanho)
  tamanho()

  let visivel = true
  new IntersectionObserver(([e]) => { visivel = e.isIntersecting }).observe(hero)

  const comeco = performance.now()
  const relogio = new THREE.Clock()
  let t = 0
  function quadro() {
    requestAnimationFrame(quadro)
    if (!visivel || document.hidden) { relogio.getDelta(); return }
    const dt = Math.min(relogio.getDelta(), 0.05)
    t += dt
    mouse.ax += (mouse.x - mouse.ax) * 0.05
    mouse.ay += (mouse.y - mouse.ay) * 0.05

    baloes.forEach((b) => {
      const u = b.userData
      b.position.x = u.base.x + Math.sin(t * u.vel * 0.6 + u.fase) * 0.35 - mouse.ax * (1.2 + u.base.z * -0.1)
      const k = Math.min(1, (performance.now() - comeco) / 1800)
      const entrada = calmo ? 0 : (1 - (1 - Math.pow(1 - k, 3))) * (12 + u.fase * 2)
      b.position.y = u.base.y + Math.sin(t * u.vel + u.fase) * 0.45 + rolagem * (7 + u.fase * 0.6) - entrada
      b.rotation.z = Math.sin(t * u.vel * 0.8 + u.fase) * 0.12
      b.rotation.y = Math.sin(t * 0.3 + u.fase) * 0.35 * u.giro + mouse.ax * 0.4
    })
    for (let i = 0; i < N; i++) {
      const c = dados[i]
      c.y -= c.v * dt * 1.6
      if (c.y < -9) { c.y = 9; c.x = (Math.random() - 0.3) * 26 }
      c.rx += c.vr * dt; c.ry += c.vr * 0.7 * dt
      tmp.position.set(c.x + Math.sin(t + c.d) * 0.4, c.y + rolagem * 4, c.z)
      tmp.rotation.set(c.rx, c.ry, c.d)
      tmp.updateMatrix()
      confete.setMatrixAt(i, tmp.matrix)
    }
    confete.instanceMatrix.needsUpdate = true

    camera.position.x = mouse.ax * 1.4
    camera.position.y = -mouse.ay * 0.9 - rolagem * 1.5
    camera.lookAt(celular ? 0 : 2.5, rolagem * -1, 0)
    renderer.render(cena, camera)
  }

  if (calmo) { renderer.render(cena, camera); return }
  quadro()
}

if (canvas && hero) iniciar()
