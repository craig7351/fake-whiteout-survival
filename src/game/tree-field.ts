import { Mesh, InstancedMesh } from '@babylonjs/core';

/** 單棵樹的佈點資料（位置固定、不隨幀變動） */
export interface TreePlacement {
  /** 使用第幾個來源樹模型（目前單一來源，保留欄位相容） */
  mesh: number;
  x: number;
  z: number;
  rotY: number;
  scale: number;
}

/**
 * 樹林：用 InstancedMesh（共用幾何、1 個來源 mesh）大量複製。
 * - 每棵是一個 InstancedMesh：共用 draw call，且**逐棵視錐剔除**（鏡頭外不畫，省效能）。
 * - 顯示數量：依生成順序啟用前 N 棵。
 * - hideRegion：把矩形區內的樹永久停用（炸開樹林露出新區）。
 */
export class TreeField {
  private source: Mesh;
  private items: { inst: InstancedMesh; x: number; z: number; hidden: boolean }[] = [];
  readonly total: number;

  constructor(sources: Mesh[], placements: TreePlacement[]) {
    this.source = sources[0];
    this.source.isVisible = false; // 只顯示實例，不顯示來源本體
    this.source.isPickable = false;
    this.total = placements.length;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const inst = this.source.createInstance(`tree${i}`);
      inst.position.set(p.x, 0, p.z);
      inst.rotation.y = p.rotY;
      inst.scaling.setAll(p.scale);
      inst.isPickable = false;
      inst.freezeWorldMatrix(); // 靜態，省每幀矩陣
      this.items.push({ inst, x: p.x, z: p.z, hidden: false });
    }
  }

  /** 顯示前 N 棵（依生成順序）；其餘停用 */
  setCount(n: number) {
    const N = Math.max(0, Math.min(this.total, Math.round(n)));
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.inst.setEnabled(i < N && !it.hidden);
    }
  }

  /** 清掉矩形區域內的所有樹（永久停用）。用於「炸開樹林」露出新區域。 */
  hideRegion(minX: number, maxX: number, minZ: number, maxZ: number) {
    for (const it of this.items) {
      if (it.x >= minX && it.x <= maxX && it.z >= minZ && it.z <= maxZ) {
        it.hidden = true;
        it.inst.setEnabled(false);
      }
    }
  }

  dispose() {
    this.items.forEach((it) => it.inst.dispose());
    this.source.dispose();
  }
}
