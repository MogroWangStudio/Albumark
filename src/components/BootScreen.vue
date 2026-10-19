<script setup lang="ts">
import { computed } from 'vue'
import LogoMark from '@/components/brand/LogoMark.vue'
import type { BootStyle } from '@/stores/settings'

/**
 * 启动画面。所有阶段的时间都以 --boot-total 为基准按比例缩放——
 * 设置里的「动画时长」就是整段动画的实际总长，换款式也不会跑偏。
 * 纯 CSS 编排：可见性恢复、掉帧都只影响观感，不会把遮罩卡在屏幕上。
 */
const props = withDefaults(
  defineProps<{
    styleId: BootStyle
    /** 总时长（毫秒） */
    duration: number
    /** 设置页里的试播：调用方负责在结束后卸载 */
    preview?: boolean
  }>(),
  { preview: false },
)

const rootStyle = computed<Record<string, string>>(() => ({
  '--boot-total': `${Math.round(props.duration)}ms`,
}))
</script>

<template>
  <div
    class="boot"
    :class="[`anim-${styleId}`, { preview }]"
    :style="rootStyle"
    aria-hidden="true"
  >
    <LogoMark :intro="styleId === 'default'" class="boot-logo" />
  </div>
</template>

<style scoped>
.boot {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: var(--bg);
}
.boot-logo {
  width: 108px;
  height: auto;
  position: relative;
  z-index: 2;
}

/* ---------- 勾勒：填充完成后放大消散，整层同步淡出 ----------
   LogoMark 的 intro 编排（0–72%）与之衔接，最后交还主界面 */
.boot.anim-default {
  animation: boot-out calc(var(--boot-total) * 0.23) var(--ease) calc(var(--boot-total) * 0.77) forwards;
}
.boot.anim-default .boot-logo {
  animation: boot-bloom calc(var(--boot-total) * 0.26) ease-in calc(var(--boot-total) * 0.75) forwards;
}

/* ---------- 快门：logo 先就位，幕从中心收开 ----------
   boot 本体必须保持透明——遮盖全由幕（::after）承担，否则幕收开后
   露出的是 boot 自身背景、主界面永远出不来；幕色比主题底色偏移一档，
   浅色 / 深色主题下开孔都清晰可辨 */
.boot.anim-shutter {
  background: transparent;
  animation: boot-out calc(var(--boot-total) * 0.21) var(--ease) calc(var(--boot-total) * 0.79) forwards;
}
.boot.anim-shutter::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--bg) 90%, var(--text));
  animation: shutter-open calc(var(--boot-total) * 0.35) cubic-bezier(0.7, 0, 0.3, 1)
    calc(var(--boot-total) * 0.45) forwards;
}
.boot.anim-shutter .boot-logo {
  animation:
    shutter-logo calc(var(--boot-total) * 0.9) var(--ease-soft) both,
    boot-bloom calc(var(--boot-total) * 0.27) ease-in calc(var(--boot-total) * 0.55) forwards;
}
@keyframes shutter-logo {
  from {
    opacity: 0;
    transform: scale(0.82);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes shutter-open {
  from {
    clip-path: circle(120% at 50% 50%);
  }
  to {
    clip-path: circle(0% at 50% 50%);
  }
}

/* ---------- 显影：照片在药水里浮现——模糊低对比渐显 + 轻微晃动 ---------- */
.boot.anim-develop {
  animation: boot-out calc(var(--boot-total) * 0.21) var(--ease) calc(var(--boot-total) * 0.79) forwards;
}
.boot.anim-develop .boot-logo {
  animation:
    develop-sway calc(var(--boot-total) * 0.64) ease-in-out both,
    develop-appear calc(var(--boot-total) * 0.64) ease both,
    boot-bloom calc(var(--boot-total) * 0.23) ease-in calc(var(--boot-total) * 0.64) forwards;
}
@keyframes develop-appear {
  from {
    opacity: 0;
    filter: blur(9px) contrast(0.45) saturate(0.4);
  }
  55% {
    opacity: 0.85;
  }
  to {
    opacity: 1;
    filter: blur(0) contrast(1) saturate(1);
  }
}
@keyframes develop-sway {
  0% {
    transform: rotate(-1.6deg) translateY(2px);
  }
  30% {
    transform: rotate(1.3deg) translateY(-1px);
  }
  55% {
    transform: rotate(-0.9deg) translateY(1px);
  }
  80%,
  100% {
    transform: rotate(0) translateY(0);
  }
}

/* ---------- 闪光：快门灯一闪而过，logo 剪影随即浮现 ---------- */
.boot.anim-flash {
  background: var(--bg);
  animation: boot-out calc(var(--boot-total) * 0.23) var(--ease) calc(var(--boot-total) * 0.77) forwards;
}
.boot.anim-flash::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: #ffffff;
  opacity: 0;
  animation: flash-pop calc(var(--boot-total) * 0.33) ease-out both;
}
.boot.anim-flash .boot-logo {
  animation:
    flash-logo calc(var(--boot-total) * 0.69) var(--ease-soft) both,
    boot-bloom calc(var(--boot-total) * 0.24) ease-in calc(var(--boot-total) * 0.66) forwards;
}
@keyframes flash-pop {
  0% {
    opacity: 0;
  }
  14% {
    opacity: 0.95;
  }
  34% {
    opacity: 0.12;
  }
  48% {
    opacity: 0.62;
  }
  100% {
    opacity: 0;
  }
}
@keyframes flash-logo {
  from {
    opacity: 0;
    transform: scale(1.12);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

/* ---------- 遮幅：上下黑边向两侧退开，像电影开场 ---------- */
.boot.anim-bars {
  background: transparent;
  animation: boot-out calc(var(--boot-total) * 0.22) var(--ease) calc(var(--boot-total) * 0.78) forwards;
}
.boot.anim-bars::before,
.boot.anim-bars::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 50%;
  z-index: 1;
  background: color-mix(in srgb, var(--bg) 92%, var(--text));
}
.boot.anim-bars::before {
  top: 0;
  animation: bars-top calc(var(--boot-total) * 0.45) cubic-bezier(0.7, 0, 0.3, 1)
    calc(var(--boot-total) * 0.55) forwards;
}
.boot.anim-bars::after {
  bottom: 0;
  animation: bars-bottom calc(var(--boot-total) * 0.45) cubic-bezier(0.7, 0, 0.3, 1)
    calc(var(--boot-total) * 0.55) forwards;
}
.boot.anim-bars .boot-logo {
  animation:
    bars-logo calc(var(--boot-total) * 0.4) var(--ease-soft) both,
    boot-bloom calc(var(--boot-total) * 0.24) ease-in calc(var(--boot-total) * 0.72) forwards;
}
@keyframes bars-top {
  to {
    transform: translateY(-100%);
  }
}
@keyframes bars-bottom {
  to {
    transform: translateY(100%);
  }
}
@keyframes bars-logo {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  55% {
    opacity: 1;
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* ---------- 对焦：取景框收拢，影像从模糊到合焦 ---------- */
.boot.anim-focus {
  animation: boot-out calc(var(--boot-total) * 0.24) var(--ease) calc(var(--boot-total) * 0.76) forwards;
}
.boot.anim-focus::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(46vmin, 320px);
  aspect-ratio: 4 / 3;
  z-index: 1;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: 2px;
  animation: focus-frame calc(var(--boot-total) * 0.55) var(--ease-soft) calc(var(--boot-total) * 0.1) both;
}
.boot.anim-focus .boot-logo {
  animation:
    focus-logo calc(var(--boot-total) * 0.55) var(--ease-soft) both,
    boot-bloom calc(var(--boot-total) * 0.22) ease-in calc(var(--boot-total) * 0.78) forwards;
}
@keyframes focus-logo {
  from {
    opacity: 0;
    filter: blur(12px);
    transform: scale(1.06);
  }
  55% {
    opacity: 1;
  }
  to {
    opacity: 1;
    filter: blur(0);
    transform: scale(1);
  }
}
@keyframes focus-frame {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.28);
  }
  25% {
    opacity: 0.85;
  }
  70% {
    opacity: 0.5;
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.94);
  }
}

/* ---------- 推移：整幅画面上移，露出工作台 ---------- */
.boot.anim-slide {
  animation: slide-out calc(var(--boot-total) * 0.55) cubic-bezier(0.65, 0, 0.35, 1)
    calc(var(--boot-total) * 0.45) forwards;
}
.boot.anim-slide .boot-logo {
  animation:
    slide-logo-in calc(var(--boot-total) * 0.45) var(--ease-soft) both,
    slide-logo-out calc(var(--boot-total) * 0.3) ease-in calc(var(--boot-total) * 0.45) forwards;
}
@keyframes slide-out {
  to {
    transform: translateY(-100%);
    visibility: hidden;
  }
}
@keyframes slide-logo-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes slide-logo-out {
  to {
    opacity: 0;
    transform: translateY(-22px);
  }
}

/* ---------- 叠影：两重影像错位叠合，最后归位 ---------- */
.boot.anim-double {
  animation: boot-out calc(var(--boot-total) * 0.22) var(--ease) calc(var(--boot-total) * 0.78) forwards;
}
.boot.anim-double .boot-logo {
  animation:
    double-in calc(var(--boot-total) * 0.62) var(--ease-soft) both,
    boot-bloom calc(var(--boot-total) * 0.22) ease-in calc(var(--boot-total) * 0.78) forwards;
}
@keyframes double-in {
  from {
    opacity: 0;
    filter: blur(7px) drop-shadow(16px 0 0 rgba(255, 167, 47, 0.5));
    transform: scale(1.03);
  }
  55% {
    opacity: 1;
  }
  to {
    opacity: 1;
    filter: blur(0) drop-shadow(0 0 0 rgba(255, 167, 47, 0));
    transform: scale(1);
  }
}

@keyframes boot-bloom {
  to {
    opacity: 0;
    transform: scale(1.45);
  }
}
@keyframes boot-out {
  to {
    opacity: 0;
    visibility: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .boot {
    animation: boot-out 1ms ease 0ms forwards !important;
  }
  .boot * {
    animation: none !important;
  }
  .boot::before,
  .boot::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
  }
}
</style>
