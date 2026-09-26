import * as THREE from "three";

/** Original wooden companions, rendered only when the board changes. */
export function createTableFigures(scene: THREE.Scene) {
  const layer = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  const indicators: THREE.MeshStandardMaterial[] = [];
  for (const [index, color] of [0x619885, 0xdba758].entries()) {
    const figure = new THREE.Group();
    figure.position.set(index === 0 ? -3.7 : 3.7, -0.22, -5.5);
    const part = (
      geometry: THREE.BufferGeometry,
      tint: number,
      x: number,
      y: number,
      z: number,
    ) => {
      const material = new THREE.MeshStandardMaterial({
        color: tint,
        roughness: 0.72,
      });
      geometries.push(geometry);
      materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      figure.add(mesh);
      return mesh;
    };
    const base = part(
      new THREE.CylinderGeometry(0.48, 0.54, 0.16, 24),
      color,
      0,
      0.08,
      0,
    );
    indicators.push(base.material);
    part(new THREE.CylinderGeometry(0.22, 0.34, 0.55, 20), color, 0, 0.43, 0);
    part(new THREE.SphereGeometry(0.31, 20, 16), 0xf0cba3, 0, 0.93, 0);
    const cap = part(
      new THREE.SphereGeometry(0.32, 20, 12),
      color,
      0,
      1.09,
      -0.025,
    );
    cap.scale.y = 0.45;
    for (const side of [-1, 1]) {
      part(
        new THREE.SphereGeometry(0.035, 10, 8),
        0x263d34,
        side * 0.11,
        0.96,
        0.284,
      );
      const arm = part(
        new THREE.SphereGeometry(0.12, 12, 8),
        0xf0cba3,
        side * 0.3,
        0.5,
        0.14,
      );
      arm.scale.y = 1.4;
    }
    layer.add(figure);
  }
  scene.add(layer);
  return {
    setVisible(visible: boolean) {
      layer.visible = visible;
    },
    update(turn: number, ended: boolean) {
      indicators.forEach((material, index) => {
        const active = !ended && turn === (index === 0 ? 1 : -1);
        material.emissive.setHex(active ? 0xf3c45f : 0x000000);
        material.emissiveIntensity = active ? 0.65 : 0;
      });
    },
    dispose() {
      scene.remove(layer);
      geometries.forEach((geometry) => {
        geometry.dispose();
      });
      materials.forEach((material) => {
        material.dispose();
      });
    },
  };
}
