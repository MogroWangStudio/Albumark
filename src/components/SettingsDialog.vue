<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { isTauri, pickDirectory, executableDir, appDataDir } from '@/core/platform'
import { useSettingsStore, type PreviewQuality, type ThemeMode } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const ws = useWorkspaceStore()

const themeModel = computed({
  get: () => settings.theme,
  set: (v: unknown) => (settings.theme = v as ThemeMode),
})

const qualityModel = computed({
  get: () => settings.previewQuality,
  set: (v: unknown) => (settings.previewQuality = v as PreviewQuality),
})

const minZoomModel = computed({
  get: () => Math.round(settings.minZoom * 100),
  set: (v: number) => (settings.minZoom = Math.round(v) / 100),
})

const dataDirShown = ref('')
onMounted(async () => {
  if (isTauri) {
    try {
      const { join } = await import('@tauri-apps/api/path')
      const base = settings.dataDir || (await executableDir()) || (await appDataDir())
      dataDirShown.value = await join(base, 'AlbumarkData')
    } catch {
      dataDirShown.value = settings.dataDir
    }
  }
})

async function changeDataDir(): Promise<void> {
  const dir = await pickDirectory('选择软件数据位置')
  if (dir) {
    settings.dataDir = dir
    dataDirShown.value = dir
    void ws.init()
  }
}

async function relaunchOobe(): Promise<void> {
  settings.oobeDone = false
  emit('close')
}
</script>

<template>
  <AppDialog :open="open" title="设置" :width="440" @close="emit('close')">
    <div class="row">
      <div class="text">
        <span class="label">外观</span>
        <p class="desc">深浅色跟随此设置或系统。</p>
      </div>
      <AppSegment
        v-model="themeModel"
        :options="[
          { value: 'auto', label: '跟随系统' },
          { value: 'dark', label: '深色' },
          { value: 'light', label: '浅色' },
        ]"
      />
    </div>

    <div class="row col">
      <div class="text">
        <span class="label">预览安全区</span>
        <p class="desc">图片允许缩小的下限；调低后可以把照片缩得更远，留出更多留白。</p>
      </div>
      <AppSlider
        v-model="minZoomModel"
        :min="30"
        :max="100"
        :step="5"
        label="最小缩放"
        :format="(v) => `${v}%`"
        title="双击复位"
        @reset="settings.minZoom = 1"
      />
    </div>

    <div class="row col">
      <div class="text">
        <span class="label">预览性能</span>
        <p class="desc">手机或老设备建议「均衡」或「省电」，可明显降低拖动时的发热与掉帧。</p>
      </div>
      <AppSegment
        v-model="qualityModel"
        :options="[
          { value: 'high', label: '高质量' },
          { value: 'balanced', label: '均衡' },
          { value: 'eco', label: '省电' },
        ]"
      />
    </div>

    <div class="row">
      <div class="text">
        <span class="label">水印吸附</span>
        <p class="desc">拖动水印时自动吸到中线与边距，并显示参考线。</p>
      </div>
      <AppSwitch v-model="settings.wmSnap" />
    </div>

    <div class="row">
      <div class="text">
        <span class="label">EXIF 缺失提醒</span>
        <p class="desc">导入时检测到照片缺少拍摄参数时给出提示。</p>
      </div>
      <AppSwitch v-model="settings.exifNotice" />
    </div>

    <template v-if="isTauri">
      <div class="row col">
        <div class="text">
          <span class="label">软件数据位置</span>
          <p class="desc mono">{{ dataDirShown || '…' }}</p>
        </div>
        <div class="btns">
          <AppButton size="sm" @click="changeDataDir">更改…</AppButton>
          <AppButton size="sm" variant="ghost" @click="relaunchOobe">重新运行引导</AppButton>
        </div>
      </div>
    </template>

    <footer class="about">
      <span>辑印 Albumark v0.4.0</span>
      <span class="sep">·</span>
      <span>本地优先处理，不上传照片</span>
      <span class="sep">·</span>
      <span>MogroWang Studio</span>
    </footer>
  </AppDialog>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.row.col {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.text {
  min-width: 0;
}
.label {
  font-size: 13px;
}
.desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}
.desc.mono {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btns {
  display: flex;
  gap: 8px;
}
.about {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--text-3);
}
.sep {
  color: var(--text-3);
}
</style>
