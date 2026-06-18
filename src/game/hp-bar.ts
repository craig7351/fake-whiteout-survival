import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, DynamicTexture } from '@babylonjs/core';

/**
 * 頭頂血條：單一 billboard 平面 + DynamicTexture（左對齊填色，依血量比例變色）。
 * 只在比例改變時重繪，避免每幀畫布操作。
 */
export class HpBar {
  readonly plane: Mesh;
  private tex: DynamicTexture;
  private lastR = -1;

  constructor(scene: Scene, width = 1.6, height = 0.24) {
    this.plane = MeshBuilder.CreatePlane('hpbar', { width, height }, scene);
    this.plane.isPickable = false;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.renderingGroupId = 1; // 疊在場景之上，避免被遮
    this.tex = new DynamicTexture('hpbar-tex', { width: 128, height: 20 }, scene, false);
    const mat = new StandardMaterial('hpbar-mat', scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    this.tex.hasAlpha = true;
    this.plane.material = mat;
    this.setEnabled(false);
    this.redraw(1);
  }

  setPosition(x: number, y: number, z: number) {
    this.plane.position.set(x, y, z);
  }

  setEnabled(on: boolean) {
    this.plane.setEnabled(on);
  }

  setRatio(r: number) {
    const cl = Math.max(0, Math.min(1, r));
    if (Math.abs(cl - this.lastR) < 0.02) return;
    this.lastR = cl;
    this.redraw(cl);
  }

  private redraw(r: number) {
    const W = 128;
    const H = 20;
    const ctx = this.tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    /** 外框底（深色） */
    ctx.fillStyle = 'rgba(10,14,24,0.9)';
    round(ctx, 1, 1, W - 2, H - 2, 8);
    ctx.fill();
    /** 內凹軌道 */
    const pad = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    round(ctx, pad, pad, W - pad * 2, H - pad * 2, 5);
    ctx.fill();
    /** 填色（左對齊） */
    const innerW = W - pad * 2;
    const fw = Math.max(0, innerW * r);
    ctx.fillStyle = r > 0.5 ? '#4ade80' : r > 0.25 ? '#fbbf24' : '#f43f5e';
    if (fw > 1) {
      round(ctx, pad, pad, fw, H - pad * 2, 5);
      ctx.fill();
    }
    this.tex.update();
  }

  dispose() {
    this.tex.dispose();
    this.plane.dispose();
  }
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
