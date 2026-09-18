<script setup lang="ts">
import { Aperture, Circle, CloudMoon, Droplet, RotateCcw, Sun, SunDim, Thermometer } from 'lucide-vue-next'
import type { Component } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import { useAdjustStore } from '@/stores/adjust'
import { ADJUST_DEFS, isNeutral } from '@/types/adjust'

const adjust = useAdjustStore()

const icons: Record<string, Component> = {
  exposure: Aperture,
  brightness: Sun,
  highlights: SunDim,
  shadows: CloudMoon,
  temperature: Thermometer,
  tint: Droplet,
  vignette: Circle,
}
</script>

<template>
  <div class="panel-scroll">
    <AppSlider
      v-for="def in ADJUST_DEFS"
      :key="def.key"
      v-model="adjust.values[def.key]"
      :min="-100"
      :max="100"
      :label="def.label"
      :icon="icons[def.key]"
      @reset="adjust.set(def.key, 0)"
    />
    <div class="foot">
      <AppButton variant="ghost" size="sm" :disabled="isNeutral(adjust.values)" @click="adjust.reset()">
        <RotateCcw :size="13" />全部重置
      </AppButton>
    </div>
    <p class="note">调节会应用到全部照片，与水印一同导出。双击名称可复位单项。</p>
  </div>
</template>

<style scoped>
.panel-scroll {
  display: flex;
  flex-direction: column;
}
.foot {
  margin-top: 12px;
}
.note {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
