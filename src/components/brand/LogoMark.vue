<script setup lang="ts">
/**
 * 品牌图形。animated=true 时（OOBE 首屏）两个小三角形交替向前「甩出」
 * 再回位，Expo-out 缓动带出速度感；中间的橙色色块保持静止。
 * intro=true 时（应用启动画面）前两段编排在这里完成：线条勾勒 →
 * 颜色逐渐填充；第三段（放大渐隐过渡进主界面）由外层启动画面接管。
 */
withDefaults(defineProps<{ animated?: boolean; intro?: boolean }>(), {
  animated: false,
  intro: false,
})
</script>

<template>
  <svg viewBox="0 0 193 132" fill="none" aria-hidden="true" :class="{ live: animated, intro }">
    <g transform="matrix(1,0,0,1,-2423.270148,-474.071526)">
      <g transform="matrix(1.383965,0,0,1.383965,-1186.384327,-269.418838)">
        <g class="wing-a" transform="matrix(-0,0.336752,0.336752,-0.262051,2461.460312,357.203354)">
          <path pathLength="1" class="ink" d="M1092.674,440.204C1095.18,435.192 1103.821,434.859 1114.1,439.379C1124.38,443.898 1133.975,452.248 1137.893,460.085C1168.09,520.478 1212.276,608.85 1212.276,608.85L1008.351,608.85C1008.351,608.85 1063.492,498.568 1092.674,440.204Z" />
        </g>
        <g class="anim tri-a">
          <g transform="matrix(-0,0.170324,0.170324,-0.132542,2643.555526,482.827901)">
            <path pathLength="1" class="ink" d="M1110.314,404.925C1110.314,404.925 1163.532,511.362 1193.073,570.444C1204.423,593.144 1195.973,608.85 1172.412,608.85C1113.055,608.85 1008.351,608.85 1008.351,608.85L1110.314,404.925Z" />
          </g>
        </g>
        <g class="anim tri-b">
          <g transform="matrix(-0,-0.170324,-0.170324,0.132542,2711.898934,687.122802)">
            <path pathLength="1" class="ink" d="M1110.314,404.925C1110.314,404.925 1168.08,520.458 1196.652,577.602C1205.887,596.071 1199.012,608.85 1179.842,608.85C1122.302,608.85 1008.351,608.85 1008.351,608.85L1110.314,404.925Z" />
          </g>
        </g>
        <g class="anim bar">
          <g transform="matrix(-0,0.304828,0.467953,0.540881,2369.507872,-107.544573)">
            <rect pathLength="1" class="ink-soft" x="989.068" y="634.644" width="224.799" height="49.456" />
          </g>
        </g>
        <g class="wing-b" transform="matrix(-0,-0.336752,-0.336752,0.262051,2894.665796,812.506259)">
          <path pathLength="1" class="ink" d="M1091.722,442.108C1094.364,436.825 1103.471,436.474 1114.305,441.237C1125.139,446.001 1135.252,454.801 1139.381,463.06C1169.52,523.337 1212.276,608.85 1212.276,608.85L1008.351,608.85C1008.351,608.85 1062.311,500.93 1091.722,442.108Z" />
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
/* 品牌色内聚为类：启动编排需要按形状取同色描边 */
.ink {
  fill: #ffa72f;
  --ink: #ffa72f;
}
.ink-soft {
  fill: #ffc473;
  --ink: #ffc473;
}
/* 只在 OOBE 首屏开启：甩出用快出慢收的指数缓动，回位柔和，营造速度感 */
.anim {
  will-change: transform;
}
.live .tri-a {
  animation: dash-a 2.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}
.live .tri-b {
  animation: dash-b 2.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}
@keyframes dash-a {
  0%,
  58% {
    transform: translate(0, 0);
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  68% {
    transform: translate(13px, -7px);
  }
  80% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(0, 0);
  }
}
@keyframes dash-b {
  0%,
  30% {
    transform: translate(0, 0);
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  40% {
    transform: translate(13px, 7px);
  }
  52% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(0, 0);
  }
}

/* ---------- 启动编排：勾勒 → 填充（纯 CSS，可见性恢复也能走完） ---------- */
/* 描边经 pathLength="1" 归一化，无需测量各路径实际长度；
   vector-effect 让所有形状的线条粗细一致（不受深层 matrix 变换影响） */
.intro path,
.intro rect {
  stroke: var(--ink);
  stroke-width: 1.6;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  fill-opacity: 0;
  animation:
    intro-draw 620ms cubic-bezier(0.6, 0, 0.3, 1) both,
    intro-fill 460ms var(--ease-soft) calc(500ms + var(--d, 0ms)) both;
}
/* 填充依次充盈：主体两翼 → 光带 → 双小三角 */
.intro .wing-a path {
  --d: 0ms;
}
.intro .wing-b path {
  --d: 60ms;
}
.intro .bar rect {
  --d: 120ms;
}
.intro .tri-a path {
  --d: 180ms;
}
.intro .tri-b path {
  --d: 240ms;
}
@keyframes intro-draw {
  to {
    stroke-dashoffset: 0;
  }
}
/* 填充漫入的同时勾勒线融进形状（描边淡出），终态与静态品牌图形一致 */
@keyframes intro-fill {
  to {
    fill-opacity: 1;
    stroke-opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .intro path,
  .intro rect {
    animation: none;
    stroke: none;
    stroke-dasharray: 0;
    fill-opacity: 1;
  }
}
</style>
