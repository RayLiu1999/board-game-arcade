import * as THREE from "three";

export interface Go3DView {
  update(
    board: readonly number[],
    lastTo: number | null,
    dead: readonly number[],
  ): void;
  focus(index: number): void;
  resetMotion(): void;
  resize(): void;
  dispose(): void;
}

export function createGo3DView(
  host: HTMLElement,
  size: number,
  onCell: (index: number) => void,
  onPreview: (index: number) => void,
  onUnavailable: () => void,
): Go3DView {
  if (![9, 13, 19].includes(size)) throw new Error("不支援的圍棋棋盤大小");
  const touchHint = host.querySelector<HTMLElement>("#go-3d-touch-hint");
  if (!touchHint) throw new Error("缺少圍棋觸控提示");
  const hint: HTMLElement = touchHint;
  const preciseTouch =
    size === 19 && window.matchMedia("(pointer: coarse)").matches;
  hint.hidden = !preciseTouch;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x324d42);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 10.8, 10.2);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xfff4df, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffe8c0, 3.2);
  keyLight.position.set(-4, 9, 5);
  scene.add(keyLight);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const box = (width: number, height: number, depth: number) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometries.push(geometry);
    return geometry;
  };
  const standard = (
    color: number,
    extra: THREE.MeshStandardMaterialParameters = {},
  ) => {
    const material = new THREE.MeshStandardMaterial({ color, ...extra });
    materials.push(material);
    return material;
  };
  const table = new THREE.Mesh(box(12, 0.22, 12), standard(0x426952));
  table.position.y = -0.34;
  scene.add(table);
  const boardBase = new THREE.Mesh(
    box(8.58, 0.3, 8.58),
    standard(0x795337, { roughness: 0.65 }),
  );
  boardBase.position.y = -0.015;
  scene.add(boardBase);
  const boardFace = new THREE.Mesh(
    box(8.24, 0.04, 8.24),
    standard(0xd6aa6b, { roughness: 0.84 }),
  );
  boardFace.position.y = 0.155;
  scene.add(boardFace);

  const half = 3.73;
  const spacing = (half * 2) / (size - 1);
  const radius = spacing * 0.43;
  const stoneHeight = Math.min(0.18, spacing * 0.2);
  const stoneY = 0.175 + stoneHeight * 0.72;
  const position = (index: number): [number, number] => [
    -half + (index % size) * spacing,
    -half + Math.floor(index / size) * spacing,
  ];

  const linePoints: THREE.Vector3[] = [];
  for (let i = 0; i < size; i++) {
    const offset = -half + i * spacing;
    linePoints.push(
      new THREE.Vector3(-half, 0.181, offset),
      new THREE.Vector3(half, 0.181, offset),
      new THREE.Vector3(offset, 0.181, -half),
      new THREE.Vector3(offset, 0.181, half),
    );
  }
  const linesGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  geometries.push(linesGeometry);
  const linesMaterial = new THREE.LineBasicMaterial({ color: 0x785636 });
  materials.push(linesMaterial);
  scene.add(new THREE.LineSegments(linesGeometry, linesMaterial));

  const starIndices =
    size === 9 ? [2, 4, 6] : size === 13 ? [3, 6, 9] : [3, 9, 15];
  const starGeometry = new THREE.SphereGeometry(0.055, 12, 8);
  geometries.push(starGeometry);
  const starMaterial = standard(0x70472a);
  for (const row of starIndices)
    for (const column of starIndices) {
      const dot = new THREE.Mesh(starGeometry, starMaterial);
      const [x, z] = position(row * size + column);
      dot.position.set(x, 0.19, z);
      scene.add(dot);
    }

  const stoneGeometry = new THREE.SphereGeometry(1, 20, 12);
  geometries.push(stoneGeometry);
  const black = standard(0x172825, { roughness: 0.24, metalness: 0.08 });
  const white = standard(0xf4eedc, { roughness: 0.34, metalness: 0.03 });
  const deadBlack = standard(0x172825, {
    roughness: 0.24,
    transparent: true,
    opacity: 0.42,
  });
  const deadWhite = standard(0xf4eedc, {
    roughness: 0.34,
    transparent: true,
    opacity: 0.42,
  });
  const stoneLayer = new THREE.Group();
  scene.add(stoneLayer);

  const ringGeometry = new THREE.TorusGeometry(1, 0.09, 8, 32);
  geometries.push(ringGeometry);
  const focusRing = new THREE.Mesh(
    ringGeometry,
    standard(0xfce6a0, { emissive: 0x80641d, emissiveIntensity: 0.5 }),
  );
  focusRing.rotation.x = Math.PI / 2;
  focusRing.scale.setScalar(radius * 1.15);
  focusRing.visible = false;
  scene.add(focusRing);
  const hoverRing = new THREE.Mesh(ringGeometry, standard(0x5f7e55));
  hoverRing.rotation.x = Math.PI / 2;
  hoverRing.scale.setScalar(radius * 1.08);
  hoverRing.visible = false;
  scene.add(hoverRing);
  const lastGeometry = new THREE.SphereGeometry(radius * 0.2, 12, 8);
  geometries.push(lastGeometry);
  const lastMarker = new THREE.Mesh(lastGeometry, standard(0xd5a341));
  lastMarker.visible = false;
  scene.add(lastMarker);

  let disposed = false;
  let previousBoard: number[] | null = null;
  let animationFrame: number | null = null;
  let pendingIndex: number | null = null;
  function clearPending(): void {
    pendingIndex = null;
    hint.textContent = "點選交叉點預覽";
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

  function animateStone(stone: THREE.Mesh): void {
    const restingY = stone.position.y;
    const startedAt = performance.now();
    stone.position.y = restingY + 0.45;
    const tick = (now: number) => {
      if (disposed || host.hidden || document.hidden) {
        stone.position.y = restingY;
        animationFrame = null;
        return;
      }
      const progress = Math.min(1, (now - startedAt) / 260);
      stone.position.y = restingY + (1 - progress) ** 2 * 0.45;
      renderer.render(scene, camera);
      animationFrame = progress < 1 ? requestAnimationFrame(tick) : null;
    };
    animationFrame = requestAnimationFrame(tick);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.18);
  const intersection = new THREE.Vector3();
  function locateCell(event: PointerEvent | MouseEvent): number | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(boardPlane, intersection)) return null;
    const column = Math.round((intersection.x + half) / spacing);
    const row = Math.round((intersection.z + half) / spacing);
    if (row < 0 || row >= size || column < 0 || column >= size) return null;
    const [x, z] = position(row * size + column);
    if (
      Math.abs(intersection.x - x) > spacing * 0.45 ||
      Math.abs(intersection.z - z) > spacing * 0.45
    )
      return null;
    return row * size + column;
  }
  function handlePointerMove(event: PointerEvent): void {
    const index = locateCell(event);
    hoverRing.visible = index !== null;
    renderer.domElement.style.cursor = index === null ? "default" : "pointer";
    if (index !== null) {
      const [x, z] = position(index);
      hoverRing.position.set(x, 0.192, z);
    }
    renderer.render(scene, camera);
  }
  function handleClick(event: MouseEvent): void {
    const index = locateCell(event);
    if (index === null) {
      clearPending();
      return;
    }
    if (preciseTouch && pendingIndex !== index) {
      onPreview(index);
      pendingIndex = index;
      hint.textContent = "再點一次確認";
      return;
    }
    clearPending();
    onCell(index);
  }
  function handleContextLoss(event: Event): void {
    event.preventDefault();
    onUnavailable();
  }
  renderer.domElement.addEventListener("pointermove", handlePointerMove);
  renderer.domElement.addEventListener("click", handleClick);
  renderer.domElement.addEventListener("webglcontextlost", handleContextLoss);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  return {
    update(board, lastTo, dead) {
      clearPending();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      const before = previousBoard;
      previousBoard = [...board];
      stoneLayer.clear();
      const deadSet = new Set(dead);
      const stones = new Map<number, THREE.Mesh>();
      board.forEach((piece, index) => {
        if (!piece) return;
        const stone = new THREE.Mesh(
          stoneGeometry,
          piece === 1
            ? deadSet.has(index)
              ? deadBlack
              : black
            : deadSet.has(index)
              ? deadWhite
              : white,
        );
        const [x, z] = position(index);
        stone.position.set(x, stoneY, z);
        stone.scale.set(radius, stoneHeight, radius);
        stoneLayer.add(stone);
        stones.set(index, stone);
      });
      lastMarker.visible = lastTo !== null && Boolean(board[lastTo]);
      if (lastMarker.visible && lastTo !== null) {
        const [x, z] = position(lastTo);
        lastMarker.position.set(x, stoneY + stoneHeight + 0.018, z);
      }
      resize();
      const landedStone = lastTo === null ? undefined : stones.get(lastTo);
      if (
        before &&
        lastTo !== null &&
        before[lastTo] === 0 &&
        board[lastTo] !== 0 &&
        landedStone &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        !document.hidden
      )
        animateStone(landedStone);
    },
    focus(index) {
      if (disposed || index < 0 || index >= size * size) return;
      const [x, z] = position(index);
      focusRing.position.set(x, 0.194, z);
      focusRing.visible = true;
      renderer.render(scene, camera);
    },
    resetMotion() {
      previousBoard = null;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("click", handleClick);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        handleContextLoss,
      );
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      hint.hidden = true;
      clearPending();
    },
  };
}
