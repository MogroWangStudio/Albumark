// 把品牌图形 logo 的嵌套 Affinity 矩阵展平为纯路径，输出各平台图标源。
// 用法：node scripts/flatten-logo.mjs  （无依赖，纯 Node）
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// SVG matrix(a,b,c,d,e,f)：x' = a·x + c·y + e；y' = b·x + d·y + f
const M = (a, b, c, d, e, f) => ({ a, b, c, d, e, f })
const compose = (p, q) =>
  M(
    p.a * q.a + p.c * q.b,
    p.b * q.a + p.d * q.b,
    p.a * q.c + p.c * q.d,
    p.b * q.c + p.d * q.d,
    p.a * q.e + p.c * q.f + p.e,
    p.b * q.e + p.d * q.f + p.f,
  )
const apply = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]

const OUTER = M(1, 0, 0, 1, -2423.270148, -474.071526)
const SCALE_G = M(1.383965, 0, 0, 1.383965, -1186.384327, -269.418838)

const ORANGE = '#FFA72F'
const ORANGE_LIGHT = '#FFC473'

// 源自 public/brand/albumark-graphic-logo.svg（ Affinity 导出）
const SOURCES = [
  {
    fill: ORANGE,
    m: M(-0, 0.336752, 0.336752, -0.262051, 2461.460312, 357.203354),
    d: 'M1092.674,440.204C1095.18,435.192 1103.821,434.859 1114.1,439.379C1124.38,443.898 1133.975,452.248 1137.893,460.085C1168.09,520.478 1212.276,608.85 1212.276,608.85L1008.351,608.85C1008.351,608.85 1063.492,498.568 1092.674,440.204Z',
  },
  {
    fill: ORANGE,
    m: M(-0, -0.170324, -0.170324, 0.132542, 2711.898934, 687.122802),
    d: 'M1110.314,404.925C1110.314,404.925 1168.08,520.458 1196.652,577.602C1205.887,596.071 1199.012,608.85 1179.842,608.85C1122.302,608.85 1008.351,608.85 1008.351,608.85L1110.314,404.925Z',
  },
  {
    fill: ORANGE,
    m: M(-0, 0.170324, 0.170324, -0.132542, 2643.555526, 482.827901),
    d: 'M1110.314,404.925C1110.314,404.925 1163.532,511.362 1193.073,570.444C1204.423,593.144 1195.973,608.85 1172.412,608.85C1113.055,608.85 1008.351,608.85 1008.351,608.85L1110.314,404.925Z',
  },
  {
    fill: ORANGE_LIGHT,
    rect: { x: 989.068, y: 634.644, w: 224.799, h: 49.456 },
    m: M(-0, 0.304828, 0.467953, 0.540881, 2369.507872, -107.544573),
  },
  {
    fill: ORANGE,
    m: M(-0, -0.336752, -0.336752, 0.262051, 2894.665796, 812.506259),
    d: 'M1091.722,442.108C1094.364,436.825 1103.471,436.474 1114.305,441.237C1125.139,446.001 1135.252,454.801 1139.381,463.06C1169.52,523.337 1212.276,608.85 1212.276,608.85L1008.351,608.85C1008.351,608.85 1062.311,500.93 1091.722,442.108Z',
  },
]

/** 对路径应用仿射变换，返回新的绝对路径 d（保留原命令结构） */
function transformPath(d, m) {
  const out = []
  const re = /([MLCZ])([^MLCZ]*)/g
  let match
  while ((match = re.exec(d))) {
    const cmd = match[1]
    if (cmd === 'Z') {
      out.push('Z')
      continue
    }
    const nums = match[2].match(/-?\d+(?:\.\d+)?/g).map(Number)
    const pts = []
    for (let i = 0; i < nums.length; i += 2) {
      pts.push(apply(m, nums[i], nums[i + 1]))
    }
    if (cmd === 'M' || cmd === 'L') {
      out.push(cmd + pts.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' '))
    } else {
      // C：每 3 个点一段
      for (let i = 0; i < pts.length; i += 3) {
        const seg = pts.slice(i, i + 3).map((p) => p.map((v) => v.toFixed(3)).join(','))
        out.push((i === 0 ? 'C' : '') + seg.join(' '))
      }
    }
  }
  return out.join('').replace(/(\d)\.000/g, '$1')
}

function rectPath(r) {
  return `M${r.x},${r.y}L${r.x + r.w},${r.y}L${r.x + r.w},${r.y + r.h}L${r.x},${r.y + r.h}Z`
}

// 展平到 193×132 基准坐标系
const flat = SOURCES.map((s) => {
  const total = compose(compose(OUTER, SCALE_G), s.m)
  const d = s.rect ? rectPath(s.rect) : s.d
  return { fill: s.fill, d: transformPath(d, total) }
})

// 计算 bbox（控制点包络足够精确）
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
for (const { d } of flat) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number)
  for (let i = 0; i < nums.length; i += 2) {
    minX = Math.min(minX, nums[i])
    maxX = Math.max(maxX, nums[i])
    minY = Math.min(minY, nums[i + 1])
    maxY = Math.max(maxY, nums[i + 1])
  }
}
const bw = maxX - minX
const bh = maxY - minY
console.log(`logo bbox: ${bw.toFixed(2)} × ${bh.toFixed(2)} @ (${minX.toFixed(2)}, ${minY.toFixed(2)})`)

/** 生成放置变换：把展平后的 bbox 缩放到 targetW 并居中到 (cx, cy) */
function placement(targetW, cx, cy) {
  const s = targetW / bw
  return M(s, 0, 0, s, cx - targetW / 2 - minX * s, cy - (bh * s) / 2 - minY * s)
}

function emitPaths(m, decimals = 2) {
  return flat
    .map(({ fill, d }) => {
      const re = /([MLCZ])([^MLCZ]*)/g
      const out = []
      let match
      while ((match = re.exec(d))) {
        const cmd = match[1]
        if (cmd === 'Z') {
          out.push('Z')
          continue
        }
        const nums = match[2].match(/-?\d+(?:\.\d+)?/g).map(Number)
        const pts = []
        for (let i = 0; i < nums.length; i += 2) pts.push(apply(m, nums[i], nums[i + 1]))
        if (cmd === 'M' || cmd === 'L') {
          out.push(cmd + pts.map((p) => p.map((v) => v.toFixed(decimals)).join(',')).join(' '))
        } else {
          for (let i = 0; i < pts.length; i += 3) {
            const seg = pts.slice(i, i + 3).map((p) => p.map((v) => v.toFixed(decimals)).join(','))
            out.push((i === 0 ? 'C' : '') + seg.join(' '))
          }
        }
      }
      return { fill, d: out.join('') }
    })
    .filter((p) => !/NaN/.test(p.d))
}

function svgFor({ size, bg, rx, logoW, fgOnly = false }) {
  const cx = size / 2
  const cy = size / 2
  const paths = emitPaths(placement(logoW, cx, cy))
    .map((p) => `  <path d="${p.d}" fill="${p.fill}"/>`)
    .join('\n')
  const bgEl = fgOnly ? '' : `  <rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"/>\n`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${bgEl}${paths}
</svg>
`
}

function vectorDrawable(logoW) {
  const paths = emitPaths(placement(logoW, 54, 54), 2)
    .map((p) => `  <path android:fillColor="${p.fill}" android:pathData="${p.d}"/>`)
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- 品牌图形（由 scripts/flatten-logo.mjs 生成），居中于 66dp 安全区内 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
${paths}
</vector>
`
}

// 桌面/通用：白底圆角方块，logo 居中占 64%
const appicon = svgFor({ size: 512, bg: '#FFFFFF', rx: 115, logoW: 328 })
mkdirSync(join(root, 'public/brand'), { recursive: true })
writeFileSync(join(root, 'public/brand/appicon.svg'), appicon)
writeFileSync(join(root, 'public/favicon.svg'), appicon)

// 前景：透明底纯 logo（512）
writeFileSync(
  join(root, 'public/brand/appicon-foreground.svg'),
  svgFor({ size: 512, logoW: 328, fgOnly: true }),
)

// Android 自适应图标矢量前景：108dp 视口，logo 宽 46dp（66dp 安全区内）
mkdirSync(join(root, 'android/app/src/main/res/drawable'), { recursive: true })
writeFileSync(join(root, 'android/app/src/main/res/drawable/ic_launcher_foreground.xml'), vectorDrawable(46))

console.log('done: appicon.svg / favicon.svg / appicon-foreground.svg / drawable/ic_launcher_foreground.xml')
