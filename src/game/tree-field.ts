import { Mesh, Matrix, Vector3, Quaternion } from '@babylonjs/core';

/** 單棵樹的佈點資料（位置固定、不隨幀變動） */
export interface TreePlacement {
  /** 使用第幾個來源樹模型 */
  mesh: number;
  x: number;
  z: number;
  rotY: number;
  scale: number;
}

/**
 * 樹林 thin-instance 場：每種樹用一個來源 mesh，各掛一塊矩陣 buffer，
 * GPU 一次畫出大量樹，但場景只多「來源 mesh 數量」個物件（而非每棵一個）。
 * → 上千棵樹的每幀 CPU 成本（剔除/矩陣/active mesh 評估）幾乎不變。
 *
 * 顯示數量控制：每個來源 mesh 的 buffer 依「全域生成順序」寫入，
 * 因此「顯示前 N 棵」對每個 mesh 而言就是其 buffer 的前綴，
 * 直接設 thinInstanceCount 即可，不需逐棵縮放隱藏。
 */
export class TreeField {
  private meshes: Mesh[];
  /** 每個全域索引（生成順序）對應到哪個來源 mesh，用來換算各 mesh 的可見前綴長度 */
  private meshSeq: number[] = [];
  readonly total: number;

  constructor(sources: Mesh[], placements: TreePlacement[]) {
    this.meshes = sources;
    this.total = placements.length;

    /** 各來源 mesh 各分到幾棵 → 配置對應大小的矩陣 buffer */
    const counts = sources.map(() => 0);
    for (const p of placements) counts[p.mesh]++;
    const buffers = counts.map((c) => new Float32Array(c * 16));
    const writeIdx = counts.map(() => 0);

    const mat = new Matrix();
    const rot = new Quaternion();
    const scl = new Vector3();
    const pos = new Vector3();
    for (const p of placements) {
      Quaternion.RotationYawPitchRollToRef(p.rotY, 0, 0, rot);
      scl.set(p.scale, p.scale, p.scale);
      pos.set(p.x, 0, p.z);
      Matrix.ComposeToRef(scl, rot, pos, mat);
      mat.copyToArray(buffers[p.mesh], writeIdx[p.mesh] * 16);
      writeIdx[p.mesh]++;
      this.meshSeq.push(p.mesh);
    }

    sources.forEach((src, i) => {
      src.isVisible = true;
      src.isPickable = false;
      /** 樹林橫跨整張地圖：停用視錐剔除直接整片渲染（thin-instance 共用一個包圍盒，避免誤剔） */
      src.alwaysSelectAsActiveMesh = true;
      src.thinInstanceSetBuffer('matrix', buffers[i], 16, true);
      src.thinInstanceCount = counts[i];
    });
  }

  /** 顯示前 N 棵（依生成順序）；其餘不渲染。只在數量變動時呼叫即可。 */
  setCount(n: number) {
    const N = Math.max(0, Math.min(this.total, Math.round(n)));
    const counts = this.meshes.map(() => 0);
    for (let g = 0; g < N; g++) counts[this.meshSeq[g]]++;
    this.meshes.forEach((src, i) => (src.thinInstanceCount = counts[i]));
  }

  dispose() {
    this.meshes.forEach((m) => m.dispose());
  }
}
