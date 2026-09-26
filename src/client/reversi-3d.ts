import * as THREE from "three";
import { createTableFigures } from "./table-figures.js";

export interface Reversi3DView {
  update(
    board: readonly number[],
    legalTargets: readonly number[],
    lastTo: number | null,
    turn: number,
    ended: boolean,
  ): void;
  setFigures(visible: boolean): void;
  focus(index: number): void;
  resetMotion(): void;
  resize(): void;
  dispose(): void;
}

/** Fixed camera and authoritative board snapshots; the scene never applies moves. */
export function createReversi3DView(
  host: HTMLElement,
  onCell: (index: number) => void,
  onUnavailable: () => void,
): Reversi3DView {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x263d34);
  const figures = createTableFigures(scene);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 10.8, 10.2);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xfff4df, 2.2));
  const light = new THREE.DirectionalLight(0xffe8c0, 3.2);
  light.position.set(-4, 9, 5);
  scene.add(light);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => {
    geometries.push(value);
    return value;
  };
  const material = (
    color: number,
    extra: THREE.MeshStandardMaterialParameters = {},
  ) => {
    const value = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.65,
      ...extra,
    });
    materials.push(value);
    return value;
  };
  const table = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(12, 0.22, 12)),
    material(0x365b4b),
  );
  table.position.y = -0.36;
  scene.add(table);
  const base = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(8.48, 0.35, 8.48)),
    material(0x825b3d),
  );
  base.position.y = -0.03;
  scene.add(base);
  const face = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(8, 0.06, 8)),
    material(0x48765a),
  );
  face.position.y = 0.175;
  scene.add(face);
  const points: THREE.Vector3[] = [];
  for (let i = -4; i <= 4; i++)
    points.push(
      new THREE.Vector3(i, 0.21, -4),
      new THREE.Vector3(i, 0.21, 4),
      new THREE.Vector3(-4, 0.21, i),
      new THREE.Vector3(4, 0.21, i),
    );
  const gridMaterial = new THREE.LineBasicMaterial({ color: 0xabc0a0 });
  materials.push(gridMaterial);
  scene.add(
    new THREE.LineSegments(
      geometry(new THREE.BufferGeometry().setFromPoints(points)),
      gridMaterial,
    ),
  );
  const discGeometry = geometry(
    new THREE.CylinderGeometry(0.39, 0.39, 0.14, 32),
  );
  const discMaterials = [
    material(0x56645b),
    material(0x152521, { roughness: 0.25 }),
    material(0xf4eedc, { roughness: 0.3 }),
  ];
  const discs = new THREE.Group();
  const hints = new THREE.Group();
  scene.add(discs, hints);
  const hintGeometry = geometry(new THREE.TorusGeometry(0.16, 0.025, 8, 24));
  const hintMaterial = material(0xd9e3ae, {
    emissive: 0x3b4f27,
    emissiveIntensity: 0.3,
  });
  const focusGeometry = geometry(new THREE.TorusGeometry(0.44, 0.025, 8, 32));
  const focusRing = new THREE.Mesh(
    focusGeometry,
    material(0xfce6a0, { emissive: 0x80641d, emissiveIntensity: 0.5 }),
  );
  focusRing.rotation.x = Math.PI / 2;
  focusRing.visible = false;
  const lastMarker = new THREE.Mesh(
    geometry(new THREE.SphereGeometry(0.065, 12, 8)),
    material(0xd5a341),
  );
  lastMarker.visible = false;
  scene.add(focusRing, lastMarker);
  const position = (index: number): [number, number] => [
    (index % 8) - 3.5,
    Math.floor(index / 8) - 3.5,
  ];
  let disposed = false;
  let previousBoard: number[] | null = null;
  let frame: number | null = null;
  let settleMotion: (() => void) | null = null;
  function stopMotion(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    settleMotion?.();
    settleMotion = null;
  }
  function resize(): void {
    if (disposed || host.hidden) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(
      1,
      1200 / (Math.max(rect.width, rect.height) * ratio),
    );
    renderer.setSize(
      Math.max(1, Math.floor(rect.width * ratio * scale)),
      Math.max(1, Math.floor(rect.height * ratio * scale)),
      false,
    );
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.21);
  function pick(event: MouseEvent): number | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit || hit.x < -4 || hit.x >= 4 || hit.z < -4 || hit.z >= 4)
      return null;
    return Math.floor(hit.z + 4) * 8 + Math.floor(hit.x + 4);
  }
  function click(event: MouseEvent): void {
    if (disposed || host.hidden) return;
    const index = pick(event);
    if (index !== null) onCell(index);
  }
  function contextLost(event: Event): void {
    event.preventDefault();
    onUnavailable();
  }
  function visibility(): void {
    if (document.hidden) stopMotion();
  }
  renderer.domElement.addEventListener("click", click);
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  document.addEventListener("visibilitychange", visibility);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  return {
    setFigures(visible) {
      if (disposed) return;
      figures.setVisible(visible);
      if (!host.hidden) renderer.render(scene, camera);
    },
    update(board, legalTargets, lastTo, turn, ended) {
      if (disposed) return;
      stopMotion();
      figures.update(turn, ended);
      const before = previousBoard;
      previousBoard = [...board];
      discs.clear();
      hints.clear();
      const flips: Array<{ mesh: THREE.Mesh; from: number; to: number }> = [];
      board.forEach((side, index) => {
        if (!side) return;
        const disc = new THREE.Mesh(discGeometry, discMaterials);
        const [x, z] = position(index);
        disc.position.set(x, 0.29, z);
        disc.rotation.x = side === 1 ? 0 : Math.PI;
        discs.add(disc);
        if (before?.[index] && before[index] !== side)
          flips.push({
            mesh: disc,
            from: side === 1 ? Math.PI : 0,
            to: disc.rotation.x,
          });
      });
      for (const index of legalTargets) {
        if (board[index]) continue;
        const hint = new THREE.Mesh(hintGeometry, hintMaterial);
        const [x, z] = position(index);
        hint.position.set(x, 0.218, z);
        hint.rotation.x = Math.PI / 2;
        hints.add(hint);
      }
      lastMarker.visible = lastTo !== null && Boolean(board[lastTo]);
      if (lastTo !== null) {
        const [x, z] = position(lastTo);
        lastMarker.position.set(x, 0.385, z);
      }
      resize();
      if (
        !flips.length ||
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      const started = performance.now();
      settleMotion = () => {
        for (const flip of flips) {
          flip.mesh.rotation.x = flip.to;
          flip.mesh.position.y = 0.29;
        }
      };
      const tick = (now: number) => {
        if (disposed || host.hidden || document.hidden) {
          stopMotion();
          return;
        }
        const progress = Math.min(1, (now - started) / 360);
        const eased = progress * progress * (3 - 2 * progress);
        for (const flip of flips) {
          flip.mesh.rotation.x = flip.from + (flip.to - flip.from) * eased;
          flip.mesh.position.y = 0.29 + Math.sin(progress * Math.PI) * 0.4;
        }
        renderer.render(scene, camera);
        frame = progress < 1 ? requestAnimationFrame(tick) : null;
        if (progress === 1) settleMotion = null;
      };
      tick(started);
    },
    focus(index) {
      if (disposed || index < 0 || index >= 64) return;
      const [x, z] = position(index);
      focusRing.position.set(x, 0.218, z);
      focusRing.visible = true;
      renderer.render(scene, camera);
    },
    resetMotion() {
      stopMotion();
      previousBoard = null;
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopMotion();
      observer.disconnect();
      renderer.domElement.removeEventListener("click", click);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      document.removeEventListener("visibilitychange", visibility);
      figures.dispose();
      for (const value of geometries) value.dispose();
      for (const value of materials) value.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
