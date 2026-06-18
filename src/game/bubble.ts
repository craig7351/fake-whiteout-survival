import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, DynamicTexture } from '@babylonjs/core';

/**
 * 顧客頭頂的情緒泡泡：圓角白底對話框 + 中央 emoji（開心 / 不耐煩）。
 * 只在 emoji 改變時重繪，空字串則隱藏。
 */
export class Bubble {
  readonly plane: Mesh;
  private tex: DynamicTexture;
  private current = '';

  constructor(scene: Scene, size = 1.1) {
    this.plane = MeshBuilder.CreatePlane('bubble', { size }, scene);
    this.plane.isPickable = false;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.renderingGroupId = 1; // 疊在場景之上
    this.tex = new DynamicTexture('bubble-tex', { width: 128, height: 128 }, scene, false);
    const mat = new StandardMaterial('bubble-mat', scene);
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
    this.plane.setEnabled(false);
  }

  setPosition(x: number, y: number, z: number) {
    this.plane.position.set(x, y, z);
  }

  /** 設定要顯示的 emoji；空字串＝隱藏 */
  set(emoji: string) {
    if (emoji === this.current) return;
    this.current = emoji;
    if (!emoji) {
      this.plane.setEnabled(false);
      return;
    }
    this.plane.setEnabled(true);
    this.redraw(emoji);
  }

  setEnabled(on: boolean) {
    if (!on) this.current = '';
    this.plane.setEnabled(on);
  }

  dispose() {
    this.tex.dispose();
    this.plane.dispose();
  }

  private redraw(emoji: string) {
    const W = 128;
    const ctx = this.tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, W);
    /** 白底圓角泡泡 + 下方小尖角 */
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    round(ctx, 12, 8, W - 24, W - 42, 26);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 12, W - 36);
    ctx.lineTo(W / 2 + 12, W - 36);
    ctx.lineTo(W / 2, W - 12);
    ctx.closePath();
    ctx.fill();
    /** emoji */
    ctx.font = '66px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, W / 2, (W - 34) / 2 + 6);
    this.tex.update();
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
