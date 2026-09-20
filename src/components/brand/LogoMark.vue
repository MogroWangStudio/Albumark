<script setup lang="ts">
/**
 * 品牌图形。animated=true 时（OOBE 首屏）两个小三角形交替向前「甩出」
 * 再回位，Expo-out 缓动带出速度感；中间的橙色色块保持静止。
 */
withDefaults(defineProps<{ animated?: boolean }>(), { animated: false })
</script>

<template>
  <svg viewBox="0 0 193 132" fill="none" aria-hidden="true" :class="{ live: animated }">
    <g transform="matrix(1,0,0,1,-2423.270148,-474.071526)">
      <g transform="matrix(1.383965,0,0,1.383965,-1186.384327,-269.418838)">
        <g transform="matrix(-0,0.336752,0.336752,-0.262051,2461.460312,357.203354)">
          <path d="M1092.674,440.204C1095.18,435.192 1103.821,434.859 1114.1,439.379C1124.38,443.898 1133.975,452.248 1137.893,460.085C1168.09,520.478 1212.276,608.85 1212.276,608.85L1008.351,608.85C1008.351,608.85 1063.492,498.568 1092.674,440.204Z" style="fill:rgb(255,167,47);" />
        </g>
        <g class="anim tri-a">
          <g transform="matrix(-0,0.170324,0.170324,-0.132542,2643.555526,482.827901)">
            <path d="M1110.314,404.925C1110.314,404.925 1163.532,511.362 1193.073,570.444C1204.423,593.144 1195.973,608.85 1172.412,608.85C1113.055,608.85 1008.351,608.85 1008.351,608.85L1110.314,404.925Z" style="fill:rgb(255,167,47);" />
          </g>
        </g>
        <g class="anim tri-b">
          <g transform="matrix(-0,-0.170324,-0.170324,0.132542,2711.898934,687.122802)">
            <path d="M1110.314,404.925C1110.314,404.925 1168.08,520.458 1196.652,577.602C1205.887,596.071 1199.012,608.85 1179.842,608.85C1122.302,608.85 1008.351,608.85 1008.351,608.85L1110.314,404.925Z" style="fill:rgb(255,167,47);" />
          </g>
        </g>
        <g class="anim bar">
          <g transform="matrix(-0,0.304828,0.467953,0.540881,2369.507872,-107.544573)">
            <rect x="989.068" y="634.644" width="224.799" height="49.456" style="fill:rgb(255,196,115);" />
          </g>
        </g>
        <g transform="matrix(-0,-0.336752,-0.336752,0.262051,2894.665796,812.506259)">
          <path d="M1091.722,442.108C1094.364,436.825 1103.471,436.474 1114.305,441.237C1125.139,446.001 1135.252,454.801 1139.381,463.06C1169.52,523.337 1212.276,608.85 1212.276,608.85L1008.351,608.85C1008.351,608.85 1062.311,500.93 1091.722,442.108Z" style="fill:rgb(255,167,47);" />
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
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
</style>
