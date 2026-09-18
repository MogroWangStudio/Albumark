<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useImagesStore } from '@/stores/images'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const images = useImagesStore()
const text = ref('')
const running = ref(false)
const rows = reactive<{ url: string; status: 'pending' | 'running' | 'ok' | 'error'; message: string }[]>([])

const hasInput = computed(() => urlList(text.value).length > 0)
const okCount = computed(() => rows.filter((r) => r.status === 'ok').length)

function urlList(t: string): string[] {
  return t
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const name = decodeURIComponent(u.pathname.split('/').pop() ?? '')
    return name.length > 34 ? `${name.slice(0, 33)}…` : name || u.hostname
  } catch {
    return url
  }
}

async function start(): Promise<void> {
  const urls = urlList(text.value)
  if (!urls.length || running.value) return
  rows.splice(0, rows.length, ...urls.map((url) => ({ url, status: 'pending' as const, message: '' })))
  running.value = true
  for (const url of urls) {
    const row = rows.find((r) => r.url === url)
    if (row) row.status = 'running'
    try {
      await images.addFromUrl(url)
      if (row) row.status = 'ok'
    } catch (e) {
      if (row) {
        row.status = 'error'
        row.message = e instanceof Error ? e.message : String(e)
      }
    }
  }
  running.value = false
  text.value = ''
}

function close(): void {
  if (running.value) return
  emit('close')
}
</script>

<template>
  <AppDialog :open="props.open" title="从链接导入照片" @close="close">
    <p class="lead">每行粘贴一个图片链接（JPG）。链接抓取在本地完成，部分网站会因跨域限制拒绝访问。</p>
    <textarea
      v-model="text"
      class="urls"
      rows="5"
      spellcheck="false"
      placeholder="https://example.com/photo-01.jpg&#10;https://example.com/photo-02.jpg"
      :disabled="running"
    />
    <div class="row">
      <AppButton variant="primary" :disabled="!hasInput || running" @click="start">
        <LoaderCircle v-if="running" :size="14" class="spin" />
        {{ running ? '导入中…' : '开始导入' }}
      </AppButton>
      <AppButton variant="ghost" @click="close">关闭</AppButton>
      <span v-if="okCount" class="ok-hint">已导入 {{ okCount }} 张</span>
    </div>
    <ul v-if="rows.length" class="results">
      <li v-for="r in rows" :key="r.url" :class="r.status">
        <CircleCheck v-if="r.status === 'ok'" :size="14" />
        <CircleAlert v-else-if="r.status === 'error'" :size="14" />
        <LoaderCircle v-else-if="r.status === 'running'" :size="14" class="spin" />
        <span v-else class="dot" />
        <span class="u" :title="r.url">{{ shortUrl(r.url) }}</span>
        <span v-if="r.message" class="msg">{{ r.message }}</span>
      </li>
    </ul>
  </AppDialog>
</template>

<style scoped>
.lead {
  color: var(--text-2);
  margin-bottom: 10px;
}
.urls {
  width: 100%;
  resize: vertical;
  min-height: 96px;
  padding: 9px 11px;
  border-radius: var(--r-m);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}
.urls:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.ok-hint {
  margin-left: auto;
  color: var(--ok);
  font-size: 12px;
}
.results {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.results li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  font-size: 12px;
}
.results li.ok :deep(svg) {
  color: var(--ok);
}
.results li.error :deep(svg) {
  color: var(--danger);
}
.results li.running :deep(svg) {
  color: var(--text-3);
}
.dot {
  width: 6px;
  height: 6px;
  margin: 0 4px;
  border-radius: 50%;
  background: var(--line-strong);
}
.u {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg {
  margin-left: auto;
  color: var(--danger);
  flex: none;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
