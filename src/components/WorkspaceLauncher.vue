<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, FolderPlus, HardDrive, History, Layers, MapPin, X } from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import { isTauri, pickDirectory } from '@/core/platform'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore, type WorkspaceMode } from '@/stores/workspace'

const ws = useWorkspaceStore()
const settings = useSettingsStore()

withDefaults(defineProps<{ closable?: boolean }>(), { closable: false })
const emit = defineEmits<{ close: [] }>()

const showOobe = computed(() => isTauri && !settings.oobeDone)

/* OOBE：软件数据位置 */
const oobePicked = ref('')
const oobeDir = computed(() => oobePicked.value || ws.defaultDataDir || '…')

async function pickDataDir(): Promise<void> {
  const dir = await pickDirectory('选择软件数据位置')
  if (dir) oobePicked.value = dir
}

function finishOobe(): void {
  settings.dataDir = oobePicked.value
  settings.oobeDone = true
  void ws.loadRecent()
}

/* 工作区 */
const newName = ref('')
const newMode = ref<WorkspaceMode>('copy')
const newParent = ref('')

const newModeModel = computed({
  get: () => newMode.value,
  set: (v: unknown) => (newMode.value = v as WorkspaceMode),
})

onMounted(() => {
  if (isTauri) {
    void ws.probeDefaultDataDir()
    void ws.loadRecent()
  }
})

const canCreate = computed(() => isTauri && !!newName.value.trim() && !!newParent.value)

async function pickParent(): Promise<void> {
  const dir = await pickDirectory('选择工作区保存位置')
  if (dir) newParent.value = dir
}

async function create(): Promise<void> {
  if (!canCreate.value) return
  await ws.create(newName.value, newParent.value, newMode.value)
}

const modeHint = computed(() =>
  newMode.value === 'copy'
    ? '把照片复制一份放进工作区文件夹，源文件移动或删除都不影响。'
    : '只记录源文件路径与内容识别码，不占用额外磁盘；源文件失联时可重新定位校对。',
)
</script>

<template>
  <div class="launcher">
    <button v-if="closable" class="close" aria-label="返回工作区" @click="emit('close')">
      <X :size="16" />
    </button>
    <div class="card">
      <LogoMark class="mark" />

      <!-- 首次启动：定位软件数据 -->
      <template v-if="showOobe">
        <h1>欢迎使用辑印</h1>
        <p class="lead">选择软件数据的存放位置。数据目录保存你的工作区记录与水印预设。</p>

        <div class="oobe-dir">
          <HardDrive :size="16" />
          <div class="dir-text">
            <span class="dir-label">数据位置</span>
            <span class="dir-path">{{ oobeDir }}</span>
          </div>
          <AppButton size="sm" @click="pickDataDir">浏览…</AppButton>
        </div>
        <p class="hint">便携版默认放在程序所在文件夹（随 U 盘携带）；换位置后软件会记住。数据子文件夹为「AlbumarkData」。</p>

        <AppButton variant="primary" class="cta" @click="finishOobe">
          开始使用<ArrowRight :size="15" />
        </AppButton>
      </template>

      <!-- 工作区选择 -->
      <template v-else>
        <h1>工作区</h1>
        <p class="lead">
          工作区是一个存放照片与整理记录的文件夹。进入工作区后才能导入照片、使用水印与调节。
        </p>

        <div v-if="ws.recent.length" class="recent">
          <span class="section"><History :size="13" />最近使用</span>
          <button
            v-for="r in ws.recent.slice(0, 6)"
            :key="r.path"
            class="ws-item"
            @click="ws.open(r.path)"
          >
            <span class="ws-name">{{ r.name }}</span>
            <span class="ws-path">{{ r.path }}</span>
            <span class="ws-mode">{{ r.mode === 'copy' ? '复制' : '链接' }}</span>
          </button>
        </div>

        <div class="new">
          <span class="section"><FolderPlus :size="13" />新建工作区</span>
          <template v-if="isTauri">
            <div class="new-form">
              <input v-model="newName" class="text-input" placeholder="工作区名称" @keyup.enter="create" />
              <AppSegment
                v-model="newModeModel"
                small
                :options="[
                  { value: 'copy', label: '复制照片' },
                  { value: 'link', label: '链接源文件' },
                ]"
              />
            </div>
            <button class="dir-pick" @click="pickParent">
              <MapPin :size="13" />
              <span>{{ newParent || '选择保存位置…' }}</span>
            </button>
            <p class="hint">{{ modeHint }}</p>
            <AppButton variant="primary" class="cta" :disabled="!canCreate || ws.loading" @click="create">
              <FolderPlus :size="15" />创建并进入
            </AppButton>
          </template>
          <template v-else>
            <p class="hint">此设备不支持文件夹工作区，可使用仅保留在本次会话的临时工作区。</p>
            <AppButton variant="primary" class="cta" @click="ws.openEphemeral()">
              <Layers :size="15" />进入临时工作区
            </AppButton>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.launcher {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--canvas);
  overflow-y: auto;
}
.close {
  position: absolute;
  top: calc(12px + var(--safe-top));
  right: calc(12px + var(--safe-right));
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--text-3);
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.close:hover {
  background: var(--hover);
  color: var(--text);
}
.card {
  width: min(520px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 34px 30px;
  border-radius: var(--r-l);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-2);
}
.mark {
  width: 108px;
  height: auto;
  margin-bottom: 16px;
  opacity: 0.95;
}
h1 {
  font-size: 21px;
  letter-spacing: -0.02em;
}
.lead {
  margin-top: 6px;
  max-width: 380px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.6;
}
.oobe-dir {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 18px;
  padding: 11px 12px;
  border-radius: var(--r-m);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  text-align: left;
}
.dir-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dir-label {
  font-size: 11px;
  color: var(--text-3);
}
.dir-path {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  letter-spacing: 0.02em;
}
.recent,
.new {
  width: 100%;
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ws-item {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  text-align: left;
  transition: background var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft);
}
.ws-item:hover {
  background: var(--hover);
  border-color: var(--line-strong);
}
.ws-name {
  font-size: 13px;
  font-weight: 500;
}
.ws-path {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.ws-mode {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}
.new-form {
  width: 100%;
  display: flex;
  gap: 8px;
  align-items: center;
}
.text-input {
  flex: 1;
  min-width: 0;
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: 12.5px;
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.dir-pick {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 11px;
  border-radius: var(--r-m);
  border: 1px dashed var(--line-strong);
  color: var(--text-2);
  font-size: 12px;
  transition: border-color var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.dir-pick:hover {
  border-color: var(--accent);
  color: var(--text);
}
.dir-pick span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.55;
}
.cta {
  width: 100%;
  margin-top: 4px;
}
</style>
