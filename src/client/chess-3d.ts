import * as THREE from "three";

export interface Chess3DView {
  update(
    board: readonly string[],
    selected: number | null,
    legalTargets: readonly number[],
    last: { readonly from?: number; readonly to?: number } | null,
  ): void;
  focus(index: number): void;
  resetMotion(): void;
  resize(): void;
  dispose(): void;
}

const GLYPHS: Record<string, string> = {
  wk: "♔",
  wq: "♕",
  wr: "♖",
  wb: "♗",
  wn: "♘",
  wp: "♙",
  bk: "♚",
  bq: "♛",
  br: "♜",
  bb: "♝",
  bn: "♞",
  bp: "♟",
};

function squarePosition(index: number): [number, number] {
  return [(index % 8) - 3.5, Math.floor(index / 8) - 3.5];
}

export function createChess3DView(
  host: HTMLElement,
  onCell: (index: number) => void,
  onUnavailable: () => void,
): Chess3DView {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x263d34);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x263d34);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 10.8, 10.2);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xfff4dc, 2.1));
  const keyLight = new THREE.DirectionalLight(0xfff1ce, 3.8);
  keyLight.position.set(-4, 9, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xa8c8c1, 1.5);
  rimLight.position.set(5, 5, -4);
  scene.add(rimLight);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const box = (width: number, height: number, depth: number) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometries.push(geometry);
    return geometry;
  };
  const cylinder = (top: number, bottom: number, height: number) => {
    const geometry = new THREE.CylinderGeometry(top, bottom, height, 20);
    geometries.push(geometry);
    return geometry;
  };
  const sphere = (radius: number) => {
    const geometry = new THREE.SphereGeometry(radius, 16, 12);
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

  const table = new THREE.Mesh(box(12, 0.22, 12), standard(0x365b4b));
  table.position.y = -0.36;
  scene.add(table);
  const boardBase = new THREE.Mesh(
    box(8.48, 0.35, 8.48),
    standard(0x825b3d, { roughness: 0.55, metalness: 0.08 }),
  );
  boardBase.position.y = -0.03;
  scene.add(boardBase);
  const boardTrim = new THREE.Mesh(box(8.24, 0.055, 8.24), standard(0xd8b984));
  boardTrim.position.y = 0.175;
  scene.add(boardTrim);

  const lightSquare = standard(0xe6d5b0, { roughness: 0.82 });
  const darkSquare = standard(0x597b69, { roughness: 0.82 });
  const selectedSquare = standard(0xd9bb68, {
    emissive: 0x775b17,
    emissiveIntensity: 0.27,
  });
  const legalSquare = standard(0xa7c795, {
    emissive: 0x315a35,
    emissiveIntensity: 0.2,
  });
  const lastSquare = standard(0xc3ae7d);
  const hoverSquare = standard(0xb5ccaa);
  const squareGeometry = box(0.995, 0.065, 0.995);
  const squares: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] =
    [];
  for (let index = 0; index < 64; index++) {
    const [x, z] = squarePosition(index);
    const square = new THREE.Mesh(
      squareGeometry,
      (Math.floor(index / 8) + (index % 8)) % 2 ? darkSquare : lightSquare,
    );
    square.position.set(x, 0.235, z);
    square.userData.index = index;
    squares.push(square);
    scene.add(square);
  }

  const focusFrame = new THREE.Group();
  const focusMaterial = standard(0xffedaa, {
    emissive: 0x8e681b,
    emissiveIntensity: 0.45,
  });
  const focusEdges: Array<[number, number, number, number]> = [
    [0.94, 0.055, 0, -0.45],
    [0.94, 0.055, 0, 0.45],
    [0.055, 0.94, -0.45, 0],
    [0.055, 0.94, 0.45, 0],
  ];
  for (const [width, depth, x, z] of focusEdges) {
    const edge = new THREE.Mesh(box(width, 0.015, depth), focusMaterial);
    edge.position.set(x, 0, z);
    focusFrame.add(edge);
  }
  focusFrame.visible = false;
  scene.add(focusFrame);

  const ivory = standard(0xf0e5c9, { roughness: 0.35, metalness: 0.1 });
  const charcoal = standard(0x263c36, { roughness: 0.4, metalness: 0.15 });
  const whiteBand = standard(0xb79d72, { metalness: 0.3, roughness: 0.35 });
  const blackBand = standard(0x9cb8a8, { metalness: 0.3, roughness: 0.35 });
  const baseGeometry = cylinder(0.31, 0.35, 0.12);
  const stemGeometry = cylinder(0.17, 0.25, 0.38);
  const crownGeometry = cylinder(0.24, 0.16, 0.13);
  const sphereGeometry = sphere(0.19);
  const towerGeometry = box(0.38, 0.24, 0.38);
  const glyphMaterials = new Map<string, THREE.SpriteMaterial>();
  const pieceLayer = new THREE.Group();
  scene.add(pieceLayer);

  function glyphMaterial(code: string): THREE.SpriteMaterial {
    const cached = glyphMaterials.get(code);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法建立棋子標記");
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '96px "Arial Unicode MS", "DejaVu Sans", serif';
    context.lineWidth = 6;
    context.strokeStyle = code[0] === "w" ? "#2b3e33" : "#e6dcbf";
    context.fillStyle = code[0] === "w" ? "#fffaf0" : "#243a33";
    context.strokeText(GLYPHS[code] ?? "", 64, 67);
    context.fillText(GLYPHS[code] ?? "", 64, 67);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    materials.push(material);
    glyphMaterials.set(code, material);
    return material;
  }

  function addPiece(code: string, index: number): THREE.Group {
    const side = code[0];
    const kind = code[1];
    const material = side === "w" ? ivory : charcoal;
    const band = side === "w" ? whiteBand : blackBand;
    const [x, z] = squarePosition(index);
    const group = new THREE.Group();
    group.position.set(x, 0.29, z);
    const base = new THREE.Mesh(baseGeometry, band);
    base.position.y = 0.045;
    group.add(base);
    const stem = new THREE.Mesh(stemGeometry, material);
    stem.position.y = 0.3;
    group.add(stem);
    if (kind === "p" || kind === "b") {
      const head = new THREE.Mesh(sphereGeometry, material);
      head.position.y = kind === "p" ? 0.58 : 0.68;
      group.add(head);
    } else if (kind === "r") {
      const tower = new THREE.Mesh(towerGeometry, material);
      tower.position.y = 0.62;
      group.add(tower);
    } else {
      const crown = new THREE.Mesh(crownGeometry, material);
      crown.position.y = kind === "n" ? 0.55 : 0.69;
      group.add(crown);
      if (kind === "k" || kind === "q") {
        const top = new THREE.Mesh(sphereGeometry, band);
        top.scale.setScalar(kind === "k" ? 0.72 : 0.55);
        top.position.y = 0.81;
        group.add(top);
      }
    }
    const glyph = new THREE.Sprite(glyphMaterial(code));
    glyph.position.y = 0.77;
    glyph.scale.set(0.6, 0.6, 1);
    group.add(glyph);
    pieceLayer.add(group);
    return group;
  }

  let selectedIndex: number | null = null;
  let legalIndices = new Set<number>();
  let lastIndices = new Set<number>();
  let hoveredIndex: number | null = null;
  let disposed = false;
  let previousBoard: string[] | null = null;
  let animationFrame: number | null = null;

  function animateMove(piece: THREE.Group, from: number, to: number): void {
    const [startX, startZ] = squarePosition(from);
    const [endX, endZ] = squarePosition(to);
    piece.position.set(startX, 0.29, startZ);
    const startedAt = performance.now();
    const tick = (now: number) => {
      if (disposed || host.hidden || document.hidden) {
        piece.position.set(endX, 0.29, endZ);
        animationFrame = null;
        return;
      }
      const progress = Math.min(1, (now - startedAt) / 320);
      const eased = progress * progress * (3 - 2 * progress);
      piece.position.set(
        startX + (endX - startX) * eased,
        0.29 + Math.sin(Math.PI * progress) * 0.48,
        startZ + (endZ - startZ) * eased,
      );
      renderer.render(scene, camera);
      animationFrame = progress < 1 ? requestAnimationFrame(tick) : null;
    };
    animationFrame = requestAnimationFrame(tick);
  }

  function colorSquares(): void {
    for (let index = 0; index < squares.length; index++) {
      const square = squares[index];
      if (!square) continue;
      square.material =
        index === selectedIndex
          ? selectedSquare
          : legalIndices.has(index)
            ? legalSquare
            : index === hoveredIndex
              ? hoverSquare
              : lastIndices.has(index)
                ? lastSquare
                : (Math.floor(index / 8) + (index % 8)) % 2
                  ? darkSquare
                  : lightSquare;
    }
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
    const width = Math.max(1, Math.floor(rect.width * ratio * scale));
    const height = Math.max(1, Math.floor(rect.height * ratio * scale));
    renderer.setSize(width, height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function locateCell(event: PointerEvent | MouseEvent): number | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(squares, false)[0];
    return typeof hit?.object.userData.index === "number"
      ? hit.object.userData.index
      : null;
  }
  function handlePointerMove(event: PointerEvent): void {
    const next = locateCell(event);
    if (next === hoveredIndex) return;
    hoveredIndex = next;
    renderer.domElement.style.cursor = next === null ? "default" : "pointer";
    colorSquares();
    renderer.render(scene, camera);
  }
  function handleClick(event: MouseEvent): void {
    const index = locateCell(event);
    if (index !== null) onCell(index);
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
    update(board, selected, legalTargets, last) {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      const before = previousBoard;
      previousBoard = [...board];
      pieceLayer.clear();
      const pieceGroups = new Map<number, THREE.Group>();
      board.forEach((code, index) => {
        if (code) pieceGroups.set(index, addPiece(code, index));
      });
      selectedIndex = selected;
      legalIndices = new Set(legalTargets);
      lastIndices = new Set(
        [last?.from, last?.to].filter((index): index is number =>
          Number.isInteger(index),
        ),
      );
      colorSquares();
      resize();
      if (
        before &&
        last?.from !== undefined &&
        last.to !== undefined &&
        before[last.from] &&
        before[last.from]?.[0] === board[last.to]?.[0] &&
        before[last.from] !== board[last.from] &&
        before[last.to] !== board[last.to] &&
        board.filter((piece, index) => piece !== before[index]).length <= 4 &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        !document.hidden
      ) {
        const landedPiece = pieceGroups.get(last.to);
        if (landedPiece) animateMove(landedPiece, last.from, last.to);
      }
    },
    focus(index) {
      if (disposed || index < 0 || index >= squares.length) return;
      const [x, z] = squarePosition(index);
      focusFrame.position.set(x, 0.279, z);
      focusFrame.visible = true;
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
      for (const texture of textures) texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
