import { Scene, Mesh, MeshBuilder, DynamicTexture, StandardMaterial, Color3 } from '@babylonjs/core';

interface FloatItem {
  plane: Mesh;
  tex: DynamicTexture;
  mat: StandardMaterial;
  t: number; // 已經過時間
  life: number; // 總壽命
  vy: number; // 上飄速度
  baseY: number;
  baseScale: number;
}

/**
 * 漂浮數字池：在 3D 場景中冒出會上飄＋淡出的文字（+$、傷害數字…）。
 * 以一組 billboard 平面（各自帶 DynamicTexture）循環使用，只在 spawn 時重畫文字。
 */
export class FloatingText {
  private items: FloatItem[] = [];
  private cursor = 0;

  constructor(scene: Scene, max = 32) {
    for (let i = 0; i < max; i++) {
      const plane = MeshBuilder.CreatePlane(`ft${i}`, { width: 1.8, height: 0.9 }, scene);
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      plane.setEnabled(false);
      const tex = new DynamicTexture(`ft-tex${i}`, { width: 256, height: 128 }, scene, false);
      tex.hasAlpha = true;
      const mat = new StandardMaterial(`ft-mat${i}`, scene);
      mat.diffuseTexture = tex;
      mat.emissiveTexture = tex;
      mat.emissiveColor = Color3.White();
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.useAlphaFromDiffuseTexture = true;
      mat.backFaceCulling = false;
      plane.material = mat;
      this.items.push({ plane, tex, mat, t: 0, life: 0, vy: 0, baseY: 0, baseScale: 1 });
    }
  }

  /** 冒一個漂浮文字 */
  spawn(text: string, x: number, y: number, z: number, color = '#ffffff', scale = 1) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const ctx = it.tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = 'bold 82px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);
    it.tex.update();
    it.plane.position.set(x, y, z);
    it.baseScale = scale;
    it.plane.scaling.setAll(scale * 0.7);
    it.mat.alpha = 1;
    it.t = 0;
    it.life = 0.9;
    it.vy = 1.8;
    it.baseY = y;
    it.plane.setEnabled(true);
  }

  /** 每幀更新：上飄、後段淡出，壽命到就回收 */
  update(dt: number) {
    for (const it of this.items) {
      if (!it.plane.isEnabled()) continue;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        it.plane.setEnabled(false);
        continue;
      }
      it.plane.position.y = it.baseY + it.vy * it.t;
      /** 前 0.12s 由 0.7→1 倍彈出，之後維持；後 40% 壽命淡出 */
      const pop = it.t < 0.12 ? 0.7 + (it.t / 0.12) * 0.3 : 1;
      it.plane.scaling.setAll(it.baseScale * pop);
      it.mat.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }

  dispose() {
    this.items.forEach((it) => {
      it.tex.dispose();
      it.mat.dispose();
      it.plane.dispose();
    });
    this.items = [];
  }
}
