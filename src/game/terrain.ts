import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Texture,
} from '@babylonjs/core';
import { CONFIG } from './config';

/** 雪原地面材質：高解析、多種隨機元素（雪丘陰影、腳印、裂冰），降低平鋪重複感 */
function snowMaterial(scene: Scene): StandardMaterial {
  const px = 1024;
  const tex = new DynamicTexture('ground-tex', px, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  /** 底色：近白的雪 */
  ctx.fillStyle = '#e9eef6';
  ctx.fillRect(0, 0, px, px);

  /** 雪丘明暗補丁（冷藍陰影 / 亮白堆雪，打破單一色塊） */
  for (let k = 0; k < 16; k++) {
    const bx = Math.random() * px;
    const by = Math.random() * px;
    const r = 60 + Math.random() * 180;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    if (Math.random() > 0.5) {
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      g.addColorStop(0, 'rgba(150,175,210,0.28)');
      g.addColorStop(1, 'rgba(150,175,210,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 顆粒雜訊（雪粒閃爍感） */
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(150,170,200,0.12)';
    ctx.fillRect(Math.random() * px, Math.random() * px, 2, 2);
  }

  /** 裂冰（藍灰鋸齒分支） */
  ctx.strokeStyle = 'rgba(120,150,190,0.35)';
  for (let k = 0; k < 9; k++) {
    let x = Math.random() * px;
    let y = Math.random() * px;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      x += (Math.random() - 0.5) * 160;
      y += (Math.random() - 0.5) * 160;
      ctx.lineTo(x, y);
    }
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.stroke();
  }

  /** 踩出的腳印（成對橢圓凹陷，隨機方向成串） */
  for (let k = 0; k < 10; k++) {
    ctx.save();
    ctx.translate(Math.random() * px, Math.random() * px);
    ctx.rotate(Math.random() * Math.PI);
    ctx.fillStyle = 'rgba(120,145,185,0.22)';
    for (let d = 0; d < 4; d++) {
      const off = (d % 2) * 14 - 7;
      ctx.beginPath();
      ctx.ellipse(off, d * 26, 7, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 6;
  tex.vScale = 6;

  const material = new StandardMaterial('ground-material', scene);
  material.diffuseTexture = tex;
  material.specularColor = Color3.Black();
  return material;
}

/** 建立平整雪原地面。 */
export function createTerrain(scene: Scene): Mesh {
  // 須涵蓋殭屍生成的東側角落（x 最遠約 66）→ 半徑需 ≥ 66
  const size = CONFIG.arenaHalf * 13;
  const ground = MeshBuilder.CreateGround('ground', { width: size, height: size }, scene);
  ground.material = snowMaterial(scene);
  ground.isPickable = false;
  return ground;
}
