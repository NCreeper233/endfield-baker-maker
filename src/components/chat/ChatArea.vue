<script setup lang="ts">
// =============================================================================
// 右侧聊天区
// -----------------------------------------------------------------------------
// 职责:
// 1. 渲染顶部聊天条(strip + name + detail + tint)
// 2. 渲染滚动容器 chat-scroll(双 mask + chat-in 动画)
// 3. 计算每条已播放消息的布局(left/top/avatarTop/showAvatar/stack)
// 4. 末尾按需渲染 LoadingBubble(自动播放占位)
// 5. 渲染末尾装饰 + 尾部留白 + 固定底部装饰
//
// 自动播放:消息流来自 store.playedMessages(已播放切片),而非全量 messages。
//   useAutoPlay 驱动定时器推进,store.advance() 让 playedCount++,
//   playedMessages 随之增长,ChatArea 响应式追加新气泡。
//   播放中(loading 阶段)末尾渲染 LoadingBubble,方向取下一条待播消息 side。
//
// 尺寸过渡链:
//   加载气泡(100×单行高) → advance → 文字气泡(prevRect=加载气泡尺寸)
//   → 文字气泡停留 → 下一条加载气泡(prevRect=上一文字气泡尺寸)
//   每个气泡出现都从上一气泡尺寸平滑过渡到自身尺寸(transform: scale)。
//
// 关键交互:`:key="chatStore.activeSub"` 强制 chat-scroll 重新挂载,
// 触发 chat-in 入场动画(必须保留)。重挂载时所有气泡首屏无 prevRect。
// =============================================================================
import { computed, inject, nextTick, onMounted, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { speakerNameKey, useChatStore } from '../../stores/chat'
import { useBubbleMeasure } from '../../composables/useBubbleMeasure'
import { useAutoPlay } from '../../composables/useAutoPlay'
import { useChatRows } from '../../composables/useChatRows'
import {
  CHAT,
  CHAT_BOTTOM_DECO,
  CHAT_DOTS_SIZE,
  CHAT_END_DECO,
  CHAT_FRAME,
  CHAT_SCROLL,
  CHAT_SHOTS,
  SCROLL_BOTTOM_PAD,
} from '../../constants/design'
import { CHARACTER_LIST_TOP, TOP_PAD } from '../../constants/characterCard'
import { MATERIALS } from '../../constants/materials'
import {
  pos,
  speakerNameStyle,
  type BoxStyle,
} from '../../utils/chatPosition'
import type { ChatRow } from '../../types/chat'
import { measureCentered } from '../../utils/measure'
import ChatAvatar from './ChatAvatar.vue'
import ChatMessageRow from './ChatMessageRow.vue'
import LoadingBubble from './LoadingBubble.vue'
import ChoicePanel from './ChoicePanel.vue'
import EditModePanel from './EditModePanel.vue'

const chatStore = useChatStore()

/**
 * 导出模式(离屏截图表现层)
 *
 * - 仅表现差异,不动数据:仍读同一 store,编辑模式本就全量渲染当前对话。
 * - 关闭自动播放 / loading 气泡 / 编辑浮层(删除钮、EditModePanel、ChoicePanel、
 *   hover 态、strip 点击循环),滚动区溢出可见 + 高度自适应内容,
 *   聊天框高度与底部装饰跟随内容生长(由 ChatExportStage 测量后 provide 注入)。
 */
const props = defineProps<{
  exportMode?: boolean
}>()

const emit = defineEmits<{
  /** 角色面板点击 ＋:请求打开"添加自定义角色"弹窗(上抛到 App) */
  (e: 'open-custom-character'): void
}>()

/** 导出模式下聊天框高度(px):由 ChatExportStage 测量注入,未注入时用设计稿固定高 */
const injectedFrameH = inject<Ref<number> | null>('exportFrameH', null)
const exportFrameH = computed(() => injectedFrameH?.value ?? CHAT_SHOTS.detail.h)

/** 聊天框三色装饰条(品红 / 黄 / 青,样式见 .chat-frame__bar--*) */
const CHAT_FRAME_BARS = ['magenta', 'yellow', 'cyan'] as const

/** 顶部聊天条三图点击循环切换(默认 v1) */
const stripVariants = [
  MATERIALS.chatStripV1,
  MATERIALS.chatStripV2,
  MATERIALS.chatStripV3,
] as const
/** 当前聊天条图片下标(存于 store:导出模式 ChatArea 实例共享同一状态) */
const stripSource = computed(() => stripVariants[chatStore.stripVariantIndex % stripVariants.length])
/** 点击聊天条:切换到下一张(导出模式静态保留当前样式,不循环;播放模式不可点击) */
function cycleStrip(): void {
  if (props.exportMode) return
  if (!isEditMode.value) return
  chatStore.cycleStrip()
}

const {
  playedMessages,
  messages,
  isLoading,
  subPlayedFlags,
  pendingChoice,
  isEditMode,
  showCharacterNames,
} = storeToRefs(chatStore)
// 测量方式与屏幕态统一(natural:false),避免 measureBubble(屏幕)与
// measureBubbleNatural(导出)的 innerW 差异(canvas 估算偏大 → 屏幕气泡内宽
// 更大 → 换行不同)。导出用同一套测量函数,保证换行与屏幕完全一致。
const { measure, clearCache: clearBubbleCache } = useBubbleMeasure({ natural: false })

/**
 * 编辑模式:本地文本缓存(消息 id → 实时输入文本)
 *
 * 用户在 contenteditable 输入时,通过 @input 实时更新此缓存,
 * 驱动 rows 重算(box/left/cursor/choicesTop 实时联动)。
 *
 * 不直接写 store(避免每次按键触发 store 更新),
 * 失焦时才通过 onMessageUpdate 持久化到 store.conversations。
 *
 * 切换对话 / 退出编辑模式时清空。
 */
const localTexts = ref<Record<number, string>>({})

/**
 * 当前鼠标悬停的消息 id(编辑模式下为 null 时不显示删除按钮)
 *
 * 必须在所有 immediate watcher 之前声明:切换对话的 watcher(immediate:true)
 * 在 setup 期间同步触发,若此处晚于 watcher 声明,会因暂时性死区 (TDZ)
 * 抛出 "Cannot access 'hoverId' before initialization",导致整页白屏。
 */
const hoverId = ref<number | null>(null)

/**
 * 消息行布局管线(rows / LoadingBubble 布局 / 滚动内容底部 / 选项面板让位)
 *
 * localTexts 与 isEditMode 为本地/共享引用,由本组件持有并传入;
 * layoutContext.fresh 由下方 watcher 翻转(切换对话 → true;首条加载气泡 → false)。
 */
const {
  layoutContext,
  rows,
  loadingLayout,
  showLoadingAvatar,
  endDecoTop,
  padTop,
  chatScrollHeight,
  choicePanelReserve,
  resolveSpeakerAvatar,
  resolveSpeakerName,
} = useChatRows({
  measure,
  measureCentered,
  localTexts,
  isEditMode,
})

function onMsgHover(messageId: number) {
  hoverId.value = messageId
}

function onMsgLeave(messageId: number) {
  if (hoverId.value === messageId) hoverId.value = null
}

// ---- 编辑模式:点击消息头像 → 弹出底部现有的角色头像菜单 ---------------------
// 复用 EditModePanel 的 character 弹窗(不另写菜单)。
// 点击头像时:记录"当前要更换身份的消息"(avatarTargetMsgId),
// 并让底部 EditModePanel 弹出角色头像选择面板;选角色后写入该消息身份。
// 管理员(mine 侧)头像不可更换:点击无反应,不弹菜单(store 层同样硬拦)。
const avatarTargetMsgId = ref<number | null>(null)
/** 底部 EditModePanel 实例(ref:通过暴露的方法弹出/关闭角色面板) */
const editModePanelRef = ref<{ openCharacterPicker: () => void; closeCharacterPicker: () => void } | null>(null)

/** 清除换头像目标(选择完毕 / 切换对话 / 删除目标消息 / 退出编辑模式时) */
function clearAvatarTarget() {
  avatarTargetMsgId.value = null
}

/**
 * 消息区头像点击(仅编辑模式,支持 toggle):
 * - mine 侧 = 管理员本人,头像不可改,什么都不做
 * - other 侧:再点当前已打开的目标头像 = 关闭;点其他头像 = 换成新目标并弹/保持面板
 */
function onMessageAvatarClick(row: ChatRow) {
  if (!isEditMode.value || row.msg.side === 'mine') return
  if (avatarTargetMsgId.value === row.msg.id) {
    avatarTargetMsgId.value = null
    editModePanelRef.value?.closeCharacterPicker()
    return
  }
  avatarTargetMsgId.value = row.msg.id
  editModePanelRef.value?.openCharacterPicker()
}

/**
 * 编辑模式:给无头像的合并消息(同一说话人连发被合并)单独补一个默认 NPC 头像
 *
 * 补完后该消息即拥有独立头像(showAvatar 变为 true),
 * 用户再点击这个头像即可打开角色菜单换成具名角色(走 onMessageAvatarClick)。
 */
function onAddAvatar(row: ChatRow) {
  if (!isEditMode.value || row.msg.side === 'mine') return
  chatStore.addMessageAvatar(row.msg.id)
}

/**
 * 编辑模式:在带头像的消息之后插入一条"以该消息所属角色发言"的新消息
 *
 * 角色/侧别直接复制源消息(side + speakerName/Avatar/CustomId),
 * 默认文本"新消息",插入后可点击气泡内联编辑。
 */
function onInsertAfter(row: ChatRow) {
  if (!isEditMode.value || chatStore.activeSub === null) return
  chatStore.insertMessageAfter(chatStore.activeSub, row.msg.id)
}

/**
 * 编辑模式:@input 实时更新 localTexts
 *
 * 触发 rows computed 重算,使气泡尺寸 / 位置 / 后续消息布局实时变化。
 */
function onTextInput(messageId: number, text: string) {
  localTexts.value[messageId] = text
}

/**
 * 编辑模式:失焦时持久化到 store(写 conversations 数据源)
 *
 * 同步更新 localTexts,确保 rows 重算时 displayText 与 store 一致,
 * 避免 store 已更新但 localTexts 仍是旧值导致显示不同步。
 */
function onMessageUpdate(messageId: number, text: string) {
  if (chatStore.activeSub === null) return
  localTexts.value[messageId] = text
  chatStore.updateMessageText(chatStore.activeSub, messageId, text)
  // 文本变更后清空测量缓存,避免旧文本的 BubbleBox 残留。
  // 全量清空而非单条删除:measure 的 key 是 text,无法用 messageId 定位旧条目;
  // ruler 测量很快(单次 DOM 读),清空后重测开销可接受。
  clearBubbleCache()
}

/**
 * 编辑模式:更新任务面板可切换样式(左端图标 / 竖条颜色 / 右端装饰)
 *
 * 点击切换后写入 store 消息字段,导出模式 ChatArea 实例读取同一份数据,
 * 保证导出的面板样式与主界面当前切换到的完全一致。
 */
function onPanelStyleUpdate(
  messageId: number,
  style: Partial<{ panelIcon: number; panelBarColor: number; panelDecoAlt: boolean }>,
) {
  if (chatStore.activeSub === null) return
  chatStore.updatePanelStyle(chatStore.activeSub, messageId, style)
}

/**
 * 编辑模式:更新选项 label(@input 实时触发,直接写 store)
 */
function onChoiceUpdate(messageId: number, choiceIndex: number, label: string) {
  if (chatStore.activeSub === null) return
  chatStore.updateChoiceLabel(chatStore.activeSub, messageId, choiceIndex, label)
}

/**
 * 编辑模式:删除某个选项(@click 触发,直接写 store)
 *
 * 若该选项是消息的最后一个选项,removeChoice 会连带删除整条消息,
 * 这里同步清理本地文本缓存 / 悬停状态 / 头像菜单目标。
 */
function onChoiceRemove(messageId: number, choiceIndex: number) {
  if (chatStore.activeSub === null) return
  const removed = chatStore.removeChoice(chatStore.activeSub, messageId, choiceIndex)
  if (!removed) return
  delete localTexts.value[messageId]
  if (hoverId.value === messageId) hoverId.value = null
  if (avatarTargetMsgId.value === messageId) clearAvatarTarget()
}

/**
 * 编辑模式:在某个选项下方插入一个新选项(@click 触发,直接写 store)
 */
function onChoiceInsert(messageId: number, choiceIndex: number) {
  if (chatStore.activeSub === null) return
  chatStore.insertChoice(chatStore.activeSub, messageId, choiceIndex)
}

/**
 * 选项面板出现/消失时滚动到底部,确保最新消息可见。
 *
 * 面板出现(非 null)时同时翻转 layoutContext.fresh=false:
 * 入场动画已结束(选择点必在 CHAT_IN_MS 之后才出现),
 * 提交后出现的选择气泡才能带 prevRect=LOADING_RECT 正常播放生长过渡。
 * 若此时仍保持 fresh=true,选择气泡会先以 undefined 渲染(无过渡),
 * 下一条消息 loading 翻转 fresh 后其 prevRect 被改写为 LOADING_RECT,
 * 触发 ChatBubble watch(prevRect) 对已显示气泡重复播放一次动画。
 */
watch(
  pendingChoice,
  () => {
    // 选择点出现或消失(提交)时一律同步翻 false:
    // 提交后首次渲染的选择气泡必带 prevRect=LOADING_RECT,
    // 与中部选择点一致正常播放生长过渡(首条为选项时同样生效)。
    layoutContext.fresh = false
    scrollToBottom()
  },
  { flush: 'sync' },
)

/** chat-scroll 容器 ref(用于自动滚动到底部) */
const scrollRef = ref<HTMLElement | null>(null)

/**
 * 滚动到底部(仅播放模式)
 *
 * 编辑模式下不强制滚动:用户需要查看/编辑所有消息,
 * 强制滚动到底部会遮挡顶部内容,影响编辑体验。
 */
function scrollToBottom() {
  if (isEditMode.value) return
  nextTick(() => {
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 消息数变化或 loading 状态变化时,滚动到底部(仅播放模式)
watch([playedMessages, isLoading], () => {
  scrollToBottom()
})

// 挂载时也滚动一次(切换对话重挂载场景;编辑模式不滚动)
onMounted(() => {
  scrollToBottom()
})

// 启动自动播放定时器序列(组件卸载时自动清理;导出模式不播放)
if (!props.exportMode) useAutoPlay()

/** 聊天条名字的绝对定位样式(普通态与编辑态共用) */
const stripNameStyle = computed(() => ({
  left: CHAT_SHOTS.strip.x + 48 + 'px',
  top: CHAT_SHOTS.strip.y + (CHAT_SHOTS.strip.h - 24.12) / 2 + 'px',
}))

/**
 * 聊天条名字是否可编辑
 *
 * 仅编辑模式 + 群聊(成员 ≥2)可编辑;私聊 / 未命名自动命名不可改(决策 4)。
 * 自定义名保存后即使成员变化也保持,直到清空回退动态名。
 */
const canEditTitle = computed(() => {
  if (!isEditMode.value || chatStore.activeSub === null) return false
  return chatStore.conversationMeta[chatStore.activeSub]?.members.length >= 2
})

/** 聊天条名字编辑草稿(本地 ref,失焦时提交到 store) */
const titleDraft = ref('')

/** 聊天条名字可编辑元素(contenteditable,文本由 titleDraft 手动同步) */
const titleEl = ref<HTMLElement | null>(null)

/**
 * 编辑中实时同步 titleDraft
 *
 * 只读 textContent(plaintext-only 下粘贴也会被压成纯文本)。
 */
function onTitleInput(e: Event) {
  titleDraft.value = (e.target as HTMLElement).textContent ?? ''
}

// 切换对话 / 模式 / 标题变化时重同步草稿(仅在未输入时生效,提交后标题变化会同步回来)
watch(
  () => [chatStore.activeSub, isEditMode.value, chatStore.currentConversationMeta?.title],
  () => {
    titleDraft.value = chatStore.currentConversationMeta?.title ?? ''
  },
  { immediate: true },
)

// 外部同步:titleEl 挂载或 titleDraft 变化时写入可编辑元素。
// 必须同时监听 titleEl——切换进编辑模式时 titleDraft 可能并未变化
// (播放模式已同步过),只监听 titleDraft 会导致元素挂载时空白。
// flush post 保证元素已挂载;聚焦输入中跳过,避免每次按键把光标重置到末尾。
watch(
  [titleEl, titleDraft],
  ([el, val]) => {
    if (el && document.activeElement !== el) el.textContent = val
  },
  { flush: 'post' },
)

/** 提交自定义名:写回 store(空串自动清空,回退动态名) */
function commitTitle() {
  if (chatStore.activeSub === null) return
  chatStore.setCustomTitle(chatStore.activeSub, titleDraft.value)
  titleDraft.value = chatStore.currentConversationMeta?.title ?? ''
}

/** 回车失焦提交(并阻止 contenteditable 默认插入换行) */
function onTitleKeydownEnter(e: KeyboardEvent) {
  e.preventDefault()
  ;(e.target as HTMLElement).blur()
}

// ---- 尺寸过渡链状态 -------------------------------------------------------
// 文字气泡出现时,从加载气泡尺寸(100×单行高)过渡到真实尺寸。
// 加载气泡出现时,从宽度 0 展开到 100(自身逻辑,无需 prevRect)。
//
// prevRect 传递规则:
//   - chat-in 期间(layoutContext.fresh=true):无 LoadingBubble,无文字气泡,空状态
//   - chat-in 结束后(layoutContext.fresh=false):文字气泡 prevRect=LOADING_RECT
//
// layoutContext.fresh 清除时机:首条 LoadingBubble 显示时(post flush)
//   保证首条文字气泡 advance 出现时 fresh 已 false,正确拿到 prevRect
// --------------------------------------------------------------------------
watch(
  () => chatStore.activeSub,
  () => {
    layoutContext.fresh = true
    // 切换对话时清空 localTexts(新对话的文本应从 store 读取,而非上一对话的缓存)
    localTexts.value = {}
    hoverId.value = null
    clearAvatarTarget()
    editModePanelRef.value?.closeCharacterPicker()
  },
  { immediate: true },
)

// 退出编辑模式时清空 localTexts(此时 store 已持久化最新文本,缓存不再需要)
watch(isEditMode, (mode) => {
  if (!mode) {
    localTexts.value = {}
    hoverId.value = null
    clearAvatarTarget()
  }
})

// isLoading 变为 true(首条 LoadingBubble 显示)后:清除 layoutContext.fresh
// 这样首条文字气泡 advance 时 fresh 已 false,能正确走 prevRect 过渡
watch(
  () => chatStore.isLoading,
  (loading) => {
    if (loading) layoutContext.fresh = false
  },
  { flush: 'post' },
)

/**
 * 起始页面(未选中对话)遮罩 + 占位图的几何
 *
 * 顶端对齐第一张一级卡片顶端(CHARACTER_LIST_TOP + TOP_PAD = 127.57),
 * 底边保持与正常对话页面 chat_strip_detail 底边相同(1019.84)。
 * 宽度 / 左侧沿用 chat_strip_detail,与正常对话页面保持一致。
 */
const emptyTop = CHARACTER_LIST_TOP + TOP_PAD
const emptyBottom = CHAT_SHOTS.detail.y + CHAT_SHOTS.detail.h
const emptyHeight = emptyBottom - emptyTop

/**
 * 聊天区域半透明白色遮罩几何:只覆盖 chat_strip_detail.png 区域
 * (与 detail 矩形完全重合,不含顶部聊天条);高度随 frameHeight
 * (导出模式随内容生长,普通模式固定设计稿高)。
 */
const overlayLeft = CHAT_SHOTS.detail.x
const overlayTop = CHAT_SHOTS.detail.y
const overlayWidth = CHAT_SHOTS.detail.w

/**
 * 编辑模式:删除某条已选对话内的消息(编辑模式):同步清空本地文本缓存
 */
function onDeleteMessage(row: ChatRow) {
  if (chatStore.activeSub === null) return
  delete localTexts.value[row.msg.id]
  chatStore.deleteMessage(chatStore.activeSub, row.msg.id)
  if (hoverId.value === row.msg.id) hoverId.value = null
  // 被删的恰好是头像菜单目标:放弃目标,避免弹窗黄圈跳回"我"的身份
  if (avatarTargetMsgId.value === row.msg.id) clearAvatarTarget()
}

/**
 * 编辑模式:复制一条居中提示文本(居中文本行的"+"按钮点击)
 * 在原文后插入一份完全相同的新行(store 层处理)
 */
function onDuplicateCentered(row: ChatRow) {
  if (chatStore.activeSub === null) return
  chatStore.duplicateCenteredMessage(chatStore.activeSub, row.msg.id)
}

/**
 * 角色名内联编辑提交:写入当前父卡的卡片级显示名覆盖
 *
 * 身份键由消息派生(speakerNameKey:mine 按本卡"我方身份"派生,管理员男/女 →
 * 'admin:male'/'admin:female',other 取 speakerCustomId / speakerName / 会话名);
 * 空名由 store 侧视为"恢复默认显示名"。
 */
function onNameUpdate(row: ChatRow, name: string) {
  if (chatStore.activeSub === null) return
  const convName = chatStore.conversations[chatStore.activeSub]?.name ?? ''
  chatStore.setCardRoleName(
    chatStore.activeCardIndex,
    speakerNameKey(row.msg, convName, chatStore.activeCardIdentity),
    name,
  )
}

/** 当前对话是否已播放完毕(未选中时为 false) */
const isConversationFinished = computed(() =>
  chatStore.activeSub === null ? false : subPlayedFlags.value[chatStore.activeSub],
)

/**
 * 是否显示末尾装饰(延迟显示)
 *
 * 对话播完后不立即显示,等 END_DECO_DELAY_MS 让最后一条消息停留一下,
 * 再显示末尾装饰,避免与最后一条消息同时出现。
 */
const END_DECO_DELAY_MS = 3000
const showEndDeco = ref(false)

watch(
  isConversationFinished,
  (finished) => {
    showEndDeco.value = false
    if (finished) {
      const timer = setTimeout(() => {
        showEndDeco.value = true
      }, END_DECO_DELAY_MS)
      // 通过 watch cleanup 清理未触发的定时器
      // (isConversationFinished 切换时 Vue 会调用上次返回的 cleanup,
      // 避免旧对话的延迟回调污染新对话)。
      return () => clearTimeout(timer)
    }
  },
  { immediate: true },
)

// ---- 导出模式表现(exportMode) ---------------------------------------------
// 只改表现不动数据:滚动区溢出可见 + 高度自适应、聊天框随内容生长、
// 底部装饰贴新帧底、末尾装饰无条件显示、动画全部关闭(见文件尾非 scoped 块)。

/** 末尾装饰可见性:导出模式无条件显示全量对话的结尾装饰(无延迟) */
const endDecoVisible = computed(() =>
  props.exportMode ? true : (showEndDeco.value && !isEditMode.value),
)

/** 滚动容器样式:导出模式高度自适应内容(auto,内联不写死 831) */
const scrollStyle = computed<BoxStyle>(() => {
  if (props.exportMode) {
    return {
      left: `${CHAT_SCROLL.x}px`,
      top: `${CHAT_SCROLL.y}px`,
      width: `${CHAT_SCROLL.w}px`,
      height: 'auto',
    }
  }
  return {
    ...pos(CHAT_SCROLL.x, CHAT_SCROLL.y, CHAT_SCROLL.w, chatScrollHeight.value),
    '--choice-reserve': `${choicePanelReserve.value}px`,
  } as BoxStyle
})

/** 聊天框高度:导出模式随内容生长,否则设计稿固定高 */
const frameHeight = computed(() =>
  props.exportMode ? exportFrameH.value : CHAT_SHOTS.detail.h,
)

/**
 * 底部装饰 top:导出模式跟随新帧底定位
 *
 * 装饰底边恒距帧底 13px(与固定态 CHAT_BOTTOM_DECO.y 相对 detail 底边一致),
 * 故帧底移动量 = 装饰移动量,换算为 top = 帧底 + 固定偏移 − 装饰高。
 */
const decoTop = computed(() => {
  if (!props.exportMode) return CHAT_BOTTOM_DECO.y
  const frameBottom = CHAT_SHOTS.detail.y + exportFrameH.value
  // 固定态:装饰底边相对帧底的偏移(负值 = 在帧底上方)
  const decoBottomOffset =
    CHAT_BOTTOM_DECO.y + CHAT_BOTTOM_DECO.h - (CHAT_SHOTS.detail.y + CHAT_SHOTS.detail.h)
  return frameBottom + decoBottomOffset - CHAT_BOTTOM_DECO.h
})
</script>

<template>
  <section class="chat-area" :class="{ 'chat-area--export': exportMode }">
    <!-- 顶部聊天条:chat_strip / chat_strip_detail 仅在选中对话时显示,遮罩始终渲染 -->
    <img
      v-if="chatStore.activeSub !== null"
      class="chat-shot chat-shot--strip"
      :class="{ 'is-editable': isEditMode }"
      :style="pos(CHAT_SHOTS.strip.x, CHAT_SHOTS.strip.y, CHAT_SHOTS.strip.w, CHAT_SHOTS.strip.h)"
      :src="stripSource"
      alt=""
      @click="cycleStrip"
    />
    <!-- 聊天框(CSS 绘制,替代 chat_strip_detail.png):框线 + 顶部线缺口 + SVG 凹口 + 三色装饰条
         仅选中对话时显示,层级高于滚动内容(z3)/底部装饰(z4),低于选项/编辑面板(z10) -->
    <div
      v-if="chatStore.activeSub !== null"
      class="chat-frame"
      :style="pos(CHAT_SHOTS.detail.x, CHAT_SHOTS.detail.y, CHAT_SHOTS.detail.w, frameHeight)"
    >
      <!-- 底部 / 左 / 右 1.5px 边框线 -->
      <div
        class="chat-frame__box"
        :style="{
          borderLeftWidth: CHAT_FRAME.line + 'px',
          borderRightWidth: CHAT_FRAME.line + 'px',
          borderBottomWidth: CHAT_FRAME.line + 'px',
        }"
      />
      <!-- 顶部左边线(留出右侧缺口) -->
      <div
        class="chat-frame__tl"
        :style="{ right: CHAT_FRAME.gap + 'px', height: CHAT_FRAME.line + 'px' }"
      />
      <!-- 顶部右端小段 -->
      <div
        class="chat-frame__tr"
        :style="{ width: CHAT_FRAME.segW + 'px', height: CHAT_FRAME.line + 'px' }"
      />
      <!-- SVG 凹口:缺口中一条中间下沉的折线 -->
      <div
        class="chat-frame__notch"
        :style="{
          right: CHAT_FRAME.segW + 'px',
          width: CHAT_FRAME.notchW + 'px',
          height: CHAT_FRAME.notchH + 'px',
        }"
      >
        <svg width="100%" height="100%" viewBox="0 0 232 10" preserveAspectRatio="none">
          <path
            d="M0,0 L16,6 L216,6 L232,0"
            fill="none"
            :stroke="CHAT_FRAME.color"
            :stroke-width="CHAT_FRAME.line"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
      <!-- 三色装饰条:品红 / 黄 / 青,各有发光阴影 + 斜切 clip-path -->
      <div
        class="chat-frame__bars"
        :style="{
          right: CHAT_FRAME.barsRight + 'px',
          height: CHAT_FRAME.barH + 'px',
          gap: CHAT_FRAME.barGap + 'px',
        }"
      >
        <span
          v-for="bar in CHAT_FRAME_BARS"
          :key="bar"
          class="chat-frame__bar"
          :class="'chat-frame__bar--' + bar"
          :style="{ width: CHAT_FRAME.barW + 'px', height: CHAT_FRAME.barH + 'px' }"
        />
      </div>
    </div>
    <!-- 聊天区域半透明白色遮罩层(选中对话时):只盖 chat_strip_detail 背景图
         (倒数第二层,背景图 z2 之上、滚动内容 z3 之下),不拦截事件 -->
    <div
      v-if="chatStore.activeSub !== null"
      class="chat-overlay"
      :style="pos(overlayLeft, overlayTop, overlayWidth, frameHeight)"
    />
    <!-- 起始页遮罩:单独控制,位置大小与 chat_empty_placeholder.png 完全一致,无圆角 -->
    <div
      v-else
      class="chat-overlay chat-overlay--empty"
      :style="pos(CHAT_SHOTS.detail.x, emptyTop, CHAT_SHOTS.detail.w, emptyHeight)"
    />
    <div
      class="chat-tint"
      :class="{ 'chat-tint--gradient': chatStore.activeSub === null }"
      :style="chatStore.activeSub === null
        ? pos(CHAT_SHOTS.detail.x, emptyTop, CHAT_SHOTS.detail.w, emptyHeight)
        : pos(CHAT_SHOTS.detail.x, CHAT_SHOTS.detail.y, CHAT_SHOTS.detail.w, frameHeight)"
    />
    <!-- 起始页占位图:未选中对话时显示,顶端对齐第一张一级卡片,底边贴 chat_strip_detail 底边 -->
    <img
      v-if="chatStore.activeSub === null"
      class="chat-empty-placeholder"
      :style="pos(CHAT_SHOTS.detail.x, emptyTop, CHAT_SHOTS.detail.w, emptyHeight)"
      :src="MATERIALS.chatEmptyPlaceholder"
      alt=""
    />
    <!-- 起始页中心 10×10 圆形点阵装饰(z-index 1,在占位图之下、遮罩层之上;与提示文字同坐标) -->
    <div
      v-if="chatStore.activeSub === null"
      class="chat-empty-dots"
      :style="pos(CHAT_SHOTS.detail.x, emptyTop, CHAT_SHOTS.detail.w, emptyHeight)"
    >
      <svg :width="CHAT_DOTS_SIZE" :height="CHAT_DOTS_SIZE" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
        <circle
          v-for="(_, i) in 100"
          :key="i"
          :cx="(i % 10) + 0.5"
          :cy="Math.floor(i / 10) + 0.5"
          r="0.08"
          fill="rgba(255, 255, 255, 0.2)"
        />
      </svg>
    </div>
    <!-- 起始页提示文字:垂直水平居中于占位图区域,两端 - 不透明,中间文字半透明 -->
    <p
      v-if="chatStore.activeSub === null"
      class="chat-empty-hint"
      :style="pos(CHAT_SHOTS.detail.x, emptyTop, CHAT_SHOTS.detail.w, emptyHeight)"
    >
      <span class="chat-empty-hint__dash">-</span><span class="chat-empty-hint__text">请选择会话</span><span class="chat-empty-hint__dash">-</span>
    </p>
    <!-- 聊天条名字:编辑模式 + 群聊可编辑(自定义名),否则只读显示动态名
         可编辑态用 contenteditable <p> 而非 <input>:与只读 <p> 同元素类型、同字体度量,
         保证两种模式文字像素级对齐(改用 input 会因 UA 内建盒模型把文字中心下移) -->
    <p
      v-if="!exportMode && canEditTitle"
      ref="titleEl"
      class="chat-strip-name chat-strip-name--input"
      :style="stripNameStyle"
      contenteditable="plaintext-only"
      aria-label="群聊名称编辑"
      @input="onTitleInput"
      @blur="commitTitle"
      @keydown.enter="onTitleKeydownEnter"
    ></p>
    <p v-else class="chat-strip-name" :style="stripNameStyle">
      {{ chatStore.counterpartName }}
    </p>
    <!-- 聊天窗口右上角装饰:左右镜像,位于遮罩之上、其他元素之下(起始页不显示) -->
    <img
      v-if="chatStore.activeSub !== null"
      class="chat-corner-deco"
      :src="MATERIALS.chatCornerDeco45"
      alt=""
    />

    <!-- 滚动容器:key=activeSub 强制重挂载触发 chat-in 动画(未选中时 key='empty') -->
    <!-- pendingChoice 存在时高度减少,让消息让出选项面板空间;
         底部羽化位置同步上移,避免出现在选项面板上方 -->
    <div
      ref="scrollRef"
      :key="chatStore.activeSub ?? 'empty'"
      class="chat-scroll"
      :class="{ 'chat-scroll--with-choice': pendingChoice && !isEditMode, 'chat-scroll--export': exportMode }"
      :style="scrollStyle"
    >
      <ChatMessageRow
        v-for="row in rows"
        :key="row.msg.id"
        :row="row"
        :is-edit-mode="exportMode ? false : isEditMode"
        :export-mode="exportMode"
        :hover-id="hoverId"
        :resolve-speaker-avatar="resolveSpeakerAvatar"
        :resolve-speaker-name="resolveSpeakerName"
        :show-character-names="showCharacterNames"
        @hover="onMsgHover"
        @leave="onMsgLeave"
        @avatar-click="onMessageAvatarClick"
        @add-avatar="onAddAvatar"
        @insert-after="onInsertAfter"
        @text-input="onTextInput"
        @message-update="onMessageUpdate"
        @choice-update="onChoiceUpdate"
        @choice-remove="onChoiceRemove"
        @choice-insert="onChoiceInsert"
        @panel-style-update="onPanelStyleUpdate"
        @delete="onDeleteMessage"
        @duplicate="onDuplicateCentered"
        @name-update="onNameUpdate"
      />

      <!-- 自动播放加载占位(编辑模式不显示) -->
      <template v-if="loadingLayout && !isEditMode">
        <ChatAvatar
          v-if="showLoadingAvatar"
          :side="loadingLayout.side"
          :stack="loadingLayout.stack"
          :base-x="loadingLayout.avatarX"
          :base-y="loadingLayout.avatarTop"
          :portrait-url="loadingLayout.portraitUrl"
          :style="pos(loadingLayout.avatarX - CHAT_SCROLL.x, loadingLayout.avatarTop - CHAT_SCROLL.y, CHAT.avatarBox, CHAT.avatarBox)"
        />
        <!-- 角色名称悬浮:加载气泡上方也显示下一条消息的说话人名(与真实气泡位置一致) -->
        <span
          v-if="showLoadingAvatar && showCharacterNames"
          class="chat-speaker-name"
          :style="speakerNameStyle(loadingLayout.side, loadingLayout.left - CHAT_SCROLL.x, loadingLayout.left - CHAT_SCROLL.x + loadingLayout.loadW, loadingLayout.top - CHAT_SCROLL.y)"
        >{{ loadingLayout.speakerName }}</span>
        <LoadingBubble
          :side="loadingLayout.side"
          :left="loadingLayout.left - CHAT_SCROLL.x"
          :top="loadingLayout.top - CHAT_SCROLL.y"
        />
      </template>

      <img
        v-if="endDecoVisible"
        class="chat-end-deco"
        :style="pos(CHAT_END_DECO.left, endDecoTop, CHAT_END_DECO.w, CHAT_END_DECO.h)"
        :src="MATERIALS.chatEndDeco"
        alt=""
      />
      <div class="chat-pad chat-pad--bottom" :style="pos(0, padTop, 1, SCROLL_BOTTOM_PAD)" />
    </div>

    <!-- 固定底部装饰(在 .chat-area 内,非 .chat-scroll);导出模式跟随新帧底 -->
    <img
      class="chat-bottom-deco"
      :style="pos(CHAT_BOTTOM_DECO.x, decoTop, CHAT_BOTTOM_DECO.w, CHAT_BOTTOM_DECO.h)"
      :src="MATERIALS.chatBottomDeco"
      alt=""
    />

    <!-- 玩家选择面板:pendingChoice 非 null 且非编辑模式时显示(导出模式不显示) -->
    <Transition name="choice-panel">
      <ChoicePanel v-if="!exportMode && pendingChoice && !isEditMode" />
    </Transition>

    <!-- 编辑模式常驻底部面板:与播放模式 ChoicePanel 同款矩形背景 + 顶部装饰图,高度 80px;
         起始页(未选中会话)不显示;导出模式不显示。
         avatar-target:头像被点击的消息 id(null = 该面板维护"我"的发送身份) -->
    <EditModePanel
      ref="editModePanelRef"
      v-if="!exportMode && isEditMode && chatStore.activeSub !== null"
      :avatar-target="avatarTargetMsgId"
      @avatar-target-used="clearAvatarTarget()"
      @open-custom-character="emit('open-custom-character')"
    />
  </section>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

.chat-area {
  @include origin-container;
}

.chat-scroll {
  position: absolute;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 3;
  scrollbar-width: thin;
  scrollbar-color: $color-scrollbar-chat transparent;
  animation: chat-in 0.3s ease;
  // 顶部 20-40px 渐隐 + 底部 40-80px 渐隐 + 右侧 14px 渐隐
  @include scroll-mask(20px, 40px, calc(100% - 80px), calc(100% - 40px), 14px);

  // 出现选项面板时:chat-scroll 高度减少 CHOICE_PANEL_RESERVE,底部羽化同步上移
  // (上移量 = reserve,经 --choice-reserve 注入,与 chatScrollHeight 保持一致)
  &--with-choice {
    @include scroll-mask(20px, 40px, calc(100% - 80px + var(--choice-reserve)), calc(100% - 40px + var(--choice-reserve)), 14px);
  }

  // 导出模式:滚动区展开到内容高度(高度由内联样式给 auto),
  // 去除滚动条 / 遮罩渐隐 / 入场动画
  &--export {
    overflow: visible;
    height: auto;
    scrollbar-width: none;
    -webkit-mask-image: none;
    mask-image: none;
    animation: none;
  }
}

.chat-strip-name {
  position: absolute;
  line-height: 1;
  white-space: nowrap;
  color: $color-text-primary;
  font-size: $font-size-name;
  font-weight: 500;
  z-index: 2;
  user-select: text;

  // 群聊名编辑态:contenteditable <p>,与只读 <p> 同一套行盒(line-height:1),
  // 文字位置天然一致;仅区分光标样式与聚焦描边
  &--input {
    width: 600px;
    cursor: text;

    &:focus {
      outline: 1px dashed rgba(255, 255, 255, 0.4);
      outline-offset: 2px;
      border-radius: 2px;
    }
  }
}

.chat-tint {
  position: absolute;
  background: $color-chat-tint;
  pointer-events: none;

  // 起始页面:从上到下透明度渐变(顶端 100% → 底端 0%)
  &--gradient {
    background: linear-gradient(
      to bottom,
      $color-chat-tint 0%,
      rgba(255, 255, 255, 0) 100%
    );
  }
}

// 聊天区域半透明白色遮罩层:只盖 chat_strip_detail 背景图
// 倒数第二层:与背景图同 z-index 但 DOM 靠后(渲染其上),滚动内容 z3 / 底部装饰 z4 都在其上方
// 下边两个角圆角(与底部面板 0 0 16px 16px 一致)
.chat-overlay {
  position: absolute;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 0 0 16px 16px;
  pointer-events: none;
  z-index: 2;

  // 起始页遮罩:无圆角(单独控制),背景从上到下渐隐(0.05 → 0)
  &--empty {
    border-radius: 0;
    background: linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.05) 0%,
      rgba(255, 255, 255, 0) 100%
    );
  }
}

.chat-empty-placeholder {
  position: absolute;
  object-fit: none;
  object-position: top center;
  pointer-events: none;
  z-index: 2;
}

.chat-empty-dots {
  position: absolute;
  pointer-events: none;
  z-index: 1;
  // 与提示文字使用相同的偏移(padding-top 30px + translateX(-25px))
  // 但 SVG 用 padding 会影响 viewBox 映射,这里改用 transform 对齐
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 30px;
  transform: translateX(-25px);
  box-sizing: border-box;
}

.chat-empty-hint {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'HarmonyOS Sans SC Medium', 'HarmonyOS Sans SC', 'Microsoft YaHei', sans-serif;
  font-size: 22px;
  letter-spacing: 2px;
  pointer-events: none;
  z-index: 3;
  padding-top: 30px;
  transform: translateX(-25px);

  &__dash {
    color: $color-text-primary;
  }

  &__text {
    color: rgba(255, 255, 255, 0.7);
  }
}

.chat-shot {
  position: absolute;
  pointer-events: none;

  &--strip {
    z-index: 1;
    // 播放模式不拦截事件、不显示手型(cycleStrip 内有 isEditMode 守卫)
    cursor: default;
    user-select: none;
    // 仅编辑模式启用点击 + 手型
    &.is-editable {
      pointer-events: auto;
      cursor: pointer;
    }
  }
}

// 聊天框(CSS 绘制边框,替代 chat_strip_detail.png):
// 框本体几何由 CHAT_FRAME / CHAT_SHOTS.detail 经内联样式注入,此处只处理视觉
.chat-frame {
  position: absolute;
  pointer-events: none;
  // 高于滚动内容(z3)/ 底部装饰(z4),低于选项/编辑面板(z10)
  z-index: 5;

  &__box {
    position: absolute;
    inset: 0;
    border-left: $color-chat-frame solid 1.5px;
    border-right: $color-chat-frame solid 1.5px;
    border-bottom: $color-chat-frame solid 1.5px;
    border-radius: 0 0 12px 12px;
  }

  &__tl,
  &__tr {
    position: absolute;
    top: 0;
    background: $color-chat-frame;
  }

  &__tl {
    left: 0;
  }

  &__tr {
    right: 0;
  }

  &__notch {
    position: absolute;
    // 凹口上移 6px,悬于框顶线上方
    top: -6px;

    // 凹口折线描边颜色由内联 :stroke 注入(CHAT_FRAME.color),
    // 避免 scoped 样式在 html-to-image 导出时丢失
  }

  &__bars {
    position: absolute;
    top: 0;
    display: flex;
    gap: 8px;
  }

  &__bar {
    display: block;
    flex-shrink: 0;

    &--magenta {
      background: $color-chat-bar-magenta;
      clip-path: polygon(0 0, 100% 0, 100% 100%, 8px 100%);
      box-shadow: 0 0 8px $color-chat-bar-magenta;
    }

    &--yellow {
      background: $color-chat-bar-yellow;
      box-shadow: 0 0 8px $color-chat-bar-yellow;
    }

    &--cyan {
      background: $color-chat-bar-cyan;
      clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%);
      box-shadow: 0 0 8px $color-chat-bar-cyan;
    }
  }
}

.chat-bottom-deco {
  position: absolute;
  z-index: 4;
  pointer-events: none;
}

// 聊天窗口右上角装饰图(左右镜像)
.chat-corner-deco {
  position: absolute;
  // 定位到聊天条右上角(strip 右端 = 546.02 + 1323 = 1869.02,strip 顶 = 114.44)
  // 用 right 定位,让 scaleX(-1) 以右边为轴翻转保持位置不变
  right: calc(100% - 1769.02px);
  top: 139.44px;
  // 水平方向镜像翻转(左右镜像),transform-origin 锁右边
  transform-origin: right center;
  transform: scaleX(-1);
  // 位于 chat_strip / chat_strip_detail 之下,chat-tint 之上
  z-index: 0;
  pointer-events: none;
  // 放大显示
  width: 150px;
  height: auto;
  opacity: 0.2;
}

.chat-end-deco {
  position: absolute;
  pointer-events: none;
  // 对话播完后从上到下入场
  animation: end-deco-in 0.2s ease-out;
}

.chat-pad {
  position: absolute;
  width: 1px;
  pointer-events: none;
}
</style>

<style>
/* 导出模式:全局关闭一切动画/过渡。
   html-to-image 截图瞬间定格,若捕捉到动画中间帧会残留半透明/半展开元素;
   子组件(EditChoiceList 按钮入场、气泡尺寸过渡等)的作用域样式管不到,
   故用非 scoped 块以 .chat-area--export 后代选择器统一关闭。 */
.chat-area--export * {
  animation: none !important;
  transition: none !important;
}
</style>
