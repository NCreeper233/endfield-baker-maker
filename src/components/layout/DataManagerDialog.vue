<script setup lang="ts">
// =============================================================================
// 数据管理弹窗(DataManagerDialog)
// -----------------------------------------------------------------------------
// 编辑模式右侧"清除数据"按钮触发,提供:
//   - 数据统计(卡片 / 对话 / 消息 / 序列化大小)
//   - 导出工程(.baker 压缩单文件,直接下载)
//   - 导入工程(选文件 → 解压校验 → 二次确认 → 整体替换)
//   - 清空对话(恢复为空工程,deep watch 自动落库;我的身份保留,可由角色面板更改)
// 破坏性操作均为两段式确认(弹窗内切换确认态),不动用现有素材图。
// =============================================================================
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '../../stores/chat'
import { INITIAL_CARDS } from '../../constants/initialCards'
import { MATERIALS } from '../../constants/materials'
import {
  downloadProject,
  deserializeProject,
  EXPORT_FILE_EXT,
  type ProjectPayload,
} from '../../composables/useChatPersistence'
import type { Card } from '../../types/chat'

const props = defineProps<{
  /** 是否展开(由 App 的清除数据按钮控制) */
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const chatStore = useChatStore()
const { cards, myIdentity, adminGender } = storeToRefs(chatStore)

/** 数据统计(卡片 / 对话 / 消息 / 序列化大小) */
const stats = computed(() => {
  const convCount = cards.value.reduce((n, c) => n + c.conversations.length, 0)
  const msgCount = cards.value.reduce(
    (n, c) => n + c.conversations.reduce((m, cv) => m + cv.messages.length, 0),
    0,
  )
  const sizeKB = JSON.stringify({ cards: cards.value, myIdentity: myIdentity.value }).length / 1024
  return { cardCount: cards.value.length, convCount, msgCount, sizeKB: sizeKB.toFixed(1) }
})

// ---- 两段式确认状态 ---------------------------------------------------------
type ConfirmKind = 'clear' | 'import' | null
const confirmKind = ref<ConfirmKind>(null)
const importError = ref('')
const pendingImport = ref<ProjectPayload | null>(null)

const confirmTexts: Record<Exclude<ConfirmKind, null>, string> = {
  clear: '将清空全部对话，确定吗？',
  import: '导入将覆盖当前全部数据，确定吗？',
}

const fileInput = ref<HTMLInputElement | null>(null)

/**
 * 每次展开弹窗都回到"导入/导出/清空"主页面
 *
 * 若用户在确认页(清空/导入)直接点遮罩或"关闭"按钮关闭,confirmKind 不会被
 * 取消动作清空;下次再打开会停留在旧确认页。这里在 open 变为 true 时统一复位。
 */
watch(
  () => props.open,
  (open) => {
    if (open) {
      confirmKind.value = null
      pendingImport.value = null
      importError.value = ''
    }
  },
)

function onExport() {
  downloadProject(cards.value, myIdentity.value, adminGender.value)
}

function onRequestClear() {
  confirmKind.value = 'clear'
}

function onPickFile() {
  importError.value = ''
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const buffer = await file.arrayBuffer()
    pendingImport.value = deserializeProject(buffer)
    importError.value = ''
    confirmKind.value = 'import'
  } catch (err) {
    pendingImport.value = null
    confirmKind.value = null
    importError.value = err instanceof Error ? err.message : '文件解析失败'
  }
}

/** 替换卡片树后同步运行时态(折叠态 / 选中 / 播放进度归零 / 选择覆盖清空) */
function applyCards(next: Card[]) {
  // 收敛到 store.replaceAllCards action,避免两处(loadProject /
  // applyCards)各自内联 7 个运行时态字段重置,未来新增字段时漏改一处。
  chatStore.replaceAllCards(next)
}

function onConfirm() {
  if (confirmKind.value === 'clear') {
    applyCards(INITIAL_CARDS)
    emit('close')
  } else if (confirmKind.value === 'import' && pendingImport.value) {
    const payload = pendingImport.value
    applyCards(payload.cards)
    // 先恢复文件记录的 adminGender,再 setMyIdentity:管理员名称会
    // 覆盖性别(身份优先,保证"管理员名 ↔ 性别"一致,避免
    // "管理员 (女) 身份却显示男头像"的分裂);角色身份不受影响。
    chatStore.adminGender = payload.adminGender
    chatStore.setMyIdentity(payload.myIdentity.name, payload.myIdentity.avatar)
    emit('close')
  }
}

function onCancelConfirm() {
  confirmKind.value = null
  pendingImport.value = null
}
</script>

<template>
  <Transition name="dm">
    <div v-if="open" class="dm" @click.self="emit('close')">
      <div class="dm__panel" :class="{ 'dm__panel--narrow': !!confirmKind }">
        <!-- 背景装饰:左上角 + 右下角两张,原始尺寸原样贴角 -->
        <img class="dm__corner dm__corner--tl" :src="MATERIALS.editPopDecoTl" alt="" />
        <img class="dm__corner dm__corner--br" :src="MATERIALS.editPopDecoBr" alt="" />
        <!-- 右上角 × 关闭按钮(置于面板坐标左上角,避免遮挡标题) -->
        <button class="dm__close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        <h2 class="dm__title">数据管理</h2>
        <p class="dm__stats">
          卡片 {{ stats.cardCount }} · 对话 {{ stats.convCount }} · 消息 {{ stats.msgCount }} · 数据
          {{ stats.sizeKB }} KB
        </p>

        <div v-if="confirmKind" class="dm__confirm">
          <p class="dm__confirm-text">{{ confirmTexts[confirmKind] }}</p>
          <div class="dm__actions">
            <button class="dm__btn dm__btn--primary" type="button" @click="onConfirm">确认</button>
            <button class="dm__btn" type="button" @click="onCancelConfirm">取消</button>
          </div>
        </div>

        <div v-else class="dm__actions">
          <button class="dm__btn dm__btn--primary" type="button" @click="onExport">导出数据</button>
          <button class="dm__btn" type="button" @click="onPickFile">导入数据</button>
          <button class="dm__btn dm__btn--danger" type="button" @click="onRequestClear">清空对话</button>
        </div>

        <p v-if="importError" class="dm__error">{{ importError }}</p>

        <input ref="fileInput" type="file" :accept="EXPORT_FILE_EXT" hidden @change="onFileChange" />
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// 数据管理弹窗:半透明遮罩 + 居中深色面板(CSS 绘制,不新增素材图)
@include dialog-shell(dm, 500px, 90%, 14px, 'stats', true);

// 数据管理专属补充:确认页收窄面板 / 统计与错误行 / 危险按钮
.dm {
  &__panel--narrow {
    // 确认页(清空/导入二次确认):只放两个按钮,宽度收窄到恰好容纳
    // (132×2 + 间距 12 + 内边距 32×2 = 340px,略留 8px 余量)
    width: 348px;
  }

  &__confirm-text {
    margin: 0 0 14px;
    font-family: $font-harmony;
    font-size: 16px;
    color: $color-subcard-text;
  }

  &__error {
    margin: 12px 0 0;
    font-family: $font-harmony;
    font-size: 14px;
    color: #ff8f8f;
  }

  &__btn--danger {
    background: #7a2e2e;
    color: #f0eeee;
  }
}
</style>
