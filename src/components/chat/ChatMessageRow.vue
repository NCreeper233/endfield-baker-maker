<script setup lang="ts">
// =============================================================================
// 单条消息行(播放/编辑模式共用)
// -----------------------------------------------------------------------------
// 职责:渲染一条 ChatRow 的完整消息(头像/文字气泡/图片/居中文本/选项列表/
//       删除按钮/补头像按钮/插入按钮/删除触发区),全部定位样式由父级注入的 row 计算。
// 设计理由:从 ChatArea 消息循环中抽出,模板行数减负;所有交互以 emit 上报,
//          父组件统一处理 hover 缓存 / store 写入。
// =============================================================================
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CHAT, CHAT_SCROLL } from '../../constants/design'
import { MATERIALS } from '../../constants/materials'
import {
  pos,
  delBtnStyle,
  delBtnHotZoneStyle,
  addBtnStyle,
  speakerNameStyle,
} from '../../utils/chatPosition'
import type { ChatRow, MessageSpeaker } from '../../types/chat'
import ChatAvatar from './ChatAvatar.vue'
import ChatBubble from './ChatBubble.vue'
import ChatCenteredText from './ChatCenteredText.vue'
import ChatPanel from './ChatPanel.vue'
import EditChoiceList from './EditChoiceList.vue'

/** 头像解析函数(由父级传入,与 store/菜单解析链一致) */
type SpeakerAvatarResolver = (msg: MessageSpeaker) => string

/** 说话人显示名解析函数(角色名称悬浮用) */
type SpeakerNameResolver = (msg: MessageSpeaker) => string

const props = defineProps<{
  /** 消息行布局结果(rows[i]) */
  row: ChatRow
  /** 编辑模式开关 */
  isEditMode: boolean
  /** 导出模式(离屏截图):与编辑模式同渲染选项按钮,但只读 */
  exportMode?: boolean
  /** 当前悬停的消息 id(用于显示删除/补头像按钮) */
  hoverId: number | null
  /** 说话人头像解析(useChatRows.resolveSpeakerAvatar) */
  resolveSpeakerAvatar: SpeakerAvatarResolver
  /** 说话人显示名解析(useChatRows.resolveSpeakerName) */
  resolveSpeakerName: SpeakerNameResolver
  /** 是否显示角色名称悬浮(store.showCharacterNames) */
  showCharacterNames: boolean
}>()

const emit = defineEmits<{
  hover: [messageId: number]
  leave: [messageId: number]
  'avatar-click': [row: ChatRow]
  'add-avatar': [row: ChatRow]
  'text-input': [messageId: number, text: string]
  'message-update': [messageId: number, text: string]
  'choice-update': [messageId: number, choiceIndex: number, label: string]
  'choice-remove': [messageId: number, choiceIndex: number]
  'choice-insert': [messageId: number, choiceIndex: number]
  'panel-style-update': [messageId: number, style: Partial<{ panelIcon: number; panelBarColor: number; panelDecoAlt: boolean }>]
  delete: [row: ChatRow]
  duplicate: [row: ChatRow]
  /** 在带头像的消息后插入一条同角色发言(编辑模式加号按钮) */
  'insert-after': [row: ChatRow]
  /** 角色名内联编辑提交:上抛父级统一写 store(空名 = 恢复默认显示名) */
  'name-update': [row: ChatRow, name: string]
}>()

/**
 * 图片消息展开动画(播放模式)
 *
 * 图片消息不显示 LoadingBubble,改为自身"从中心点展开淡入":
 * - 播放模式追加新消息(row.prevRect 存在):从 scale(0.3) + opacity 0 过渡到原尺寸
 * - 首屏 / 编辑模式:无动画,直接原尺寸显示
 * 用与 ChatBubble 相同的双 rAF 手法:先 paint 初始态,再切换目标值触发 CSS transition。
 */
const imageExpanded = ref(false)

/** 是否需要图片展开动画(播放模式 + 非首屏追加) */
const imageAnimating = computed(() => !props.isEditMode && !!props.row.prevRect)

/**
 * 当前消息是否渲染为选项列表(而非普通气泡)
 *
 * 编辑模式 + 导出模式均按选项按钮渲染(导出为只读);
 * 播放模式仍按气泡渲染(用首选项 label 作占位文本,点击触发 ChoicePanel)。
 */
const hasChoices = computed(
  () => (props.isEditMode || !!props.exportMode) && !!props.row.msg.choices?.length,
)

// ---- 角色名内联编辑(编辑模式点击气泡上方角色名小字) --------------------------
/** 是否处于角色名编辑态(点击进入,blur/回车提交,Esc 取消) */
const nameEditing = ref(false)
/** 角色名编辑草稿(本地 ref,提交时上抛父级写 store) */
const nameDraft = ref('')
/** 角色名可编辑元素(contenteditable,文本由 nameDraft 手动同步) */
const nameEl = ref<HTMLElement | null>(null)

/** 点击角色名:进入内联编辑(预填当前显示名,含已有覆盖,便于微调) */
function startNameEdit() {
  if (!props.isEditMode) return
  nameDraft.value = props.resolveSpeakerName(props.row.msg)
  nameEditing.value = true
}

/** 编辑中实时同步 nameDraft(只读 textContent,plaintext-only 下粘贴也会被压成纯文本) */
function onNameInput(e: Event) {
  nameDraft.value = (e.target as HTMLElement).textContent ?? ''
}

/** 提交角色名:上抛父级统一写 store(空名视为"恢复默认"),并退出编辑态 */
function commitName() {
  if (!nameEditing.value) return
  emit('name-update', props.row, nameDraft.value)
  nameEditing.value = false
}

/** Esc:取消编辑,不提交 */
function cancelNameEdit() {
  nameEditing.value = false
}

/** 回车失焦提交(并阻止 contenteditable 默认插入换行) */
function onNameKeydownEnter(e: KeyboardEvent) {
  e.preventDefault()
  ;(e.target as HTMLElement).blur()
}

// 外部同步:nameEl 挂载或 nameDraft 变化时写入可编辑元素。
// 必须同时监听 nameEl——进入编辑态时 nameDraft 可能并未变化(预填=当前名),
// 只监听 nameDraft 会导致元素挂载时空白。flush post 保证元素已挂载;
// 聚焦输入中跳过,避免每次按键把光标重置到末尾(与聊天条标题编辑同手法)。
watch(
  [nameEl, nameDraft],
  ([el, val]) => {
    if (el && document.activeElement !== el) el.textContent = val
  },
  { flush: 'post' },
)

// 进入编辑态:聚焦 + 全选(便于直接覆盖输入)。
// 必须在 nameEl 挂载后(post flush)执行;与上面的文本同步 watcher 分离注册,
// 保证先同步文本再聚焦(聚焦后同步 watcher 会因 activeElement 命中而跳过)。
watch(
  [nameEditing, nameEl],
  ([editing, el]) => {
    if (!editing || !el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  },
  { flush: 'post' },
)

/**
 * 展开动画的双层 rAF 句柄
 *
 * 保存到实例变量,组件卸载时统一 cancelAnimationFrame,
 * 避免已卸载组件的 imageExpanded 被回调写入。
 */
let imgRaf1 = 0
let imgRaf2 = 0

onMounted(() => {
  if (imageAnimating.value) {
    imgRaf1 = requestAnimationFrame(() => {
      imgRaf2 = requestAnimationFrame(() => {
        imageExpanded.value = true
      })
    })
  }
})

// 卸载时清理未触发的 rAF,避免回调写入已卸载组件的 imageExpanded
onUnmounted(() => {
  if (imgRaf1) cancelAnimationFrame(imgRaf1)
  if (imgRaf2) cancelAnimationFrame(imgRaf2)
})

/** 图片展开动画的 style:从锚定侧(对方左缘 / 我方右缘)向外展开 + 淡入 */
const imageAnimStyle = computed(() => {
  if (!imageAnimating.value) return {}
  return {
    transform: imageExpanded.value ? 'scale(1)' : 'scale(0.3)',
    opacity: imageExpanded.value ? 1 : 0,
    'transform-origin': props.row.msg.side === 'mine' ? 'right center' : 'left center',
    transition: 'transform 0.14s ease-out, opacity 0.14s ease-out',
  }
})
</script>

<template>
  <ChatAvatar
    v-if="row.showAvatar && !hasChoices"
    :side="row.msg.side"
    :stack="row.stack"
    :base-x="row.avatarX"
    :base-y="row.avatarTop"
    :portrait-url="resolveSpeakerAvatar(row.msg)"
    :class="{ 'chat-avatar--pickable': isEditMode && row.msg.side !== 'mine' }"
    :style="pos(row.avatarX - CHAT_SCROLL.x, row.avatarTop - CHAT_SCROLL.y, CHAT.avatarBox, CHAT.avatarBox)"
    @click="emit('avatar-click', row)"
  />
  <!-- 角色名称悬浮:贴在带头像消息的气泡上缘上方,悬浮于消息间空隙(不占布局);
       锚定跟随气泡侧缘(other 左缘起向右 / mine 右缘起向左),仅带头像行显示。
       编辑模式可点击进入内联改名(卡片级显示名覆盖,仅影响显示,不改写数据);
       点击后原地变输入框(contenteditable),文本由 nameDraft 手动同步(不插值,避免光标重置) -->
  <span
    v-if="row.showAvatar && !hasChoices && showCharacterNames && nameEditing"
    ref="nameEl"
    class="chat-speaker-name chat-speaker-name--editable chat-speaker-name--editing"
    contenteditable="plaintext-only"
    :style="speakerNameStyle(row.msg.side, row.left - CHAT_SCROLL.x, row.left - CHAT_SCROLL.x + row.box.rectW, row.bubbleTop - CHAT_SCROLL.y)"
    @input="onNameInput"
    @blur="commitName"
    @keydown.enter="onNameKeydownEnter"
    @keydown.esc="cancelNameEdit"
  ></span>
  <span
    v-else-if="row.showAvatar && !hasChoices && showCharacterNames"
    class="chat-speaker-name"
    :class="{ 'chat-speaker-name--editable': isEditMode }"
    :style="speakerNameStyle(row.msg.side, row.left - CHAT_SCROLL.x, row.left - CHAT_SCROLL.x + row.box.rectW, row.bubbleTop - CHAT_SCROLL.y)"
    @click="startNameEdit"
  >{{ resolveSpeakerName(row.msg) }}</span>
  <ChatBubble
      v-if="!hasChoices && !row.msg.image && !row.msg.centered && !row.msg.panel"
      :text="row.displayText"
      :box="row.box"
      :side="row.msg.side"
      :left="row.left - CHAT_SCROLL.x"
      :top="row.bubbleTop - CHAT_SCROLL.y"
      :prev-rect="row.prevRect"
      :editable="isEditMode"
      :message-index="row.msg.id"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @input="(v: string) => emit('text-input', row.msg.id, v)"
      @update:text="(v: string) => emit('message-update', row.msg.id, v)"
    />
    <!-- 图片消息:纯图片无气泡(固定显示区域,contain 等比完整显示);
         播放模式追加时带展开动画,首屏/编辑模式直接显示 -->
    <img
      v-else-if="row.msg.image"
      class="chat-image"
      :class="{ 'chat-image--anim': imageAnimating }"
      :src="row.msg.image"
      :style="[pos(row.left - CHAT_SCROLL.x, row.bubbleTop - CHAT_SCROLL.y, row.box.rectW, row.box.rectH), imageAnimStyle]"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      alt=""
    />
    <!-- 居中提示文本:无气泡 / 无角色归属,水平居中纯白小号文字(编辑模式可改) -->
    <ChatCenteredText
      v-else-if="row.msg.centered"
      :text="row.displayText"
      :box="row.box"
      :left="row.left - CHAT_SCROLL.x"
      :top="row.bubbleTop - CHAT_SCROLL.y"
      :editable="isEditMode"
      :message-index="row.msg.id"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @input="(v: string) => emit('text-input', row.msg.id, v)"
      @update:text="(v: string) => emit('message-update', row.msg.id, v)"
    />
    <!-- 分段矩形面板:固定 1089×78 圆角 #2a2a2a,无气泡无归属,水平居中(编辑模式同理) -->
    <ChatPanel
      v-else-if="row.msg.panel"
      :text="row.displayText"
      :box="row.box"
      :left="row.left - CHAT_SCROLL.x"
      :top="row.bubbleTop - CHAT_SCROLL.y"
      :editable="isEditMode"
      :message-index="row.msg.id"
      :panel-icon="row.msg.panelIcon"
      :panel-bar-color="row.msg.panelBarColor"
      :panel-deco-alt="row.msg.panelDecoAlt"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @input="(v: string) => emit('text-input', row.msg.id, v)"
      @update:text="(v: string) => emit('message-update', row.msg.id, v)"
      @update:style="(s: { panelIcon?: number; panelBarColor?: number; panelDecoAlt?: boolean }) => emit('panel-style-update', row.msg.id, s)"
    />
    <!-- 编辑模式:mine 消息有 choices 时,在气泡下方独占一行渲染可编辑选项
         按钮水平居中于 chat-scroll,与气泡宽度无关 -->
    <EditChoiceList
      v-if="hasChoices"
      :choices="row.msg.choices!"
      :message-id="row.msg.id"
      :top="row.choicesTop - CHAT_SCROLL.y"
      :readonly="!isEditMode"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @update:label="(ci: number, v: string) => emit('choice-update', row.msg.id, ci, v)"
      @remove="(ci: number) => emit('choice-remove', row.msg.id, ci)"
      @insert="(ci: number) => emit('choice-insert', row.msg.id, ci)"
    />
    <!-- 编辑模式:删除按钮的扩展触发区(气泡左/右 15px 空白带,仅触发显示,不可见)。
         必须渲染在删除/补头像/添加按钮之前:三者同为 z-index 5,后渲染者覆盖先渲染者,
         若触发区压住按钮会拦截其点击(居中文本行的触发区覆盖整个按钮区),删除将失效。 -->
    <div
      v-if="isEditMode && !hasChoices"
      class="chat-msg-del-catch"
      :style="delBtnHotZoneStyle(row)"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
    ></div>
    <!-- 编辑模式:悬停消息时显示的删除按钮(我方在气泡左侧,对方在右侧)
         选项消息(带 choices)除外:选项列表已自带逐项删除图标,不再叠加消息级删除钮 -->
    <button
      v-if="isEditMode && !hasChoices"
      class="chat-msg-del"
      :class="{ 'chat-msg-del--visible': hoverId === row.msg.id }"
      type="button"
      :style="delBtnStyle(row)"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @click="emit('delete', row)"
    >
      <img class="chat-msg-del__icon" :src="MATERIALS.deleteMsgBtn" alt="删除消息" />
    </button>
    <!-- 编辑模式:无头像的合并消息,悬停时在删除按钮(icon_btn_cancel)旁显示补头像按钮
         (材质与删除钮同为 icon_btn_cancel,旋转 45° 视觉成"+",
         点击给该消息补一个默认 NPC 头像,之后可点新头像进菜单换角色)
         选项消息(带 choices)除外:选项列表已自带逐项删除图标 -->
    <button
      v-if="isEditMode && row.msg.side === 'other' && !row.showAvatar && !hasChoices"
      class="chat-plus"
      :class="{ 'chat-plus--visible': hoverId === row.msg.id }"
      type="button"
      aria-label="给这条消息添加头像"
      :style="addBtnStyle(row, true)"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @click="emit('add-avatar', row)"
    >
    <img class="chat-plus__icon" :src="MATERIALS.deleteMsgBtn" alt="+" />
  </button>
    <!-- 编辑模式:带头像的消息,悬停在删除按钮旁显示"插入"按钮(icon_btn_cancel 旋转 45° 成"+")
         点击在该消息之后插入一条"以该消息所属角色发言"的新消息(默认文本"新消息",
         插入后点击气泡可内联编辑;与"补头像"加号互斥——那条只出现在无头像的合并消息) -->
    <button
      v-if="isEditMode && row.showAvatar && !hasChoices"
      class="chat-plus"
      :class="{ 'chat-plus--visible': hoverId === row.msg.id }"
      type="button"
      aria-label="在这条消息后插入一条发言"
      :style="addBtnStyle(row, true)"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @click="emit('insert-after', row)"
    >
      <img class="chat-plus__icon" :src="MATERIALS.deleteMsgBtn" alt="+" />
    </button>
    <!-- 编辑模式:居中提示文本行,悬停在删除按钮旁显示"添加"按钮(icon_btn_cancel 旋转 45° 成"+")
         点击在原文后复制插入一条相同的居中文本行(材质与删除/补头像钮同为 icon_btn_cancel) -->
    <button
      v-if="isEditMode && row.msg.centered"
      class="chat-plus"
      :class="{ 'chat-plus--visible': hoverId === row.msg.id }"
      type="button"
      aria-label="复制这条居中文本"
      :style="addBtnStyle(row, false)"
      @mouseenter="emit('hover', row.msg.id)"
      @mouseleave="emit('leave', row.msg.id)"
      @click="emit('duplicate', row)"
    >
      <img class="chat-plus__icon" :src="MATERIALS.deleteMsgBtn" alt="+" />
    </button>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

// 图片消息:纯图片无气泡,按真实显示尺寸渲染(无底色)
.chat-image {
  position: absolute;
  border-radius: 12px;
}

// 编辑模式:消息删除按钮(悬停消息时显示,我方气泡左侧 / 对方气泡右侧)
// 位于 chat-scroll 内,层级高于气泡与头像
.chat-msg-del {
  position: absolute;
  z-index: 5;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  // 默认透明且不拦截事件,悬停到消息上(通过 hoverId 精确控制该条)才显示
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  // 触发按钮自身悬停保持显示(移动到按钮上不消失)
  &:hover {
    opacity: 1;
    pointer-events: auto;
  }

  &__icon {
    width: 100%;
    height: 100%;
    display: block;
    user-select: none;
    // 与右上角编辑按钮组(.edit-toggle)一致的半透明 + hover 灰染样式
    opacity: 0.5;
  }

  // hover:压暗为 #999898 灰色(同 .edit-toggle:hover img)
  &:hover .chat-msg-del__icon {
    filter: $icon-hover-gray-filter;
  }
}

// 当某条消息处于悬停态时,显示该条对应的删除按钮
// (hoverId 由父组件模板驱动 class,不能用 CSS 兄弟选择器,这里由 ref 控制)
.chat-msg-del--visible {
  opacity: 1;
  pointer-events: auto;
}

// 删除按钮的扩展触发区:覆盖气泡左/右侧 15px 的空白带,不可见但可触发悬停显示
.chat-msg-del-catch {
  position: absolute;
  z-index: 5;
  pointer-events: auto;
}

// 编辑模式:合并消息(无头像)的"补头像"按钮,悬停在删除按钮旁出现
.chat-plus {
  position: absolute;
  z-index: 5;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  box-sizing: border-box;
  // 视觉图标在扩大的悬停判定盒内居中(盒尺寸由 addBtnStyle 传入)
  display: flex;
  align-items: center;
  justify-content: center;
  // 默认透明且不拦截事件,悬停到消息上(由 hoverId 控制)才显示
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  // 按钮自身悬停保持显示
  &:hover {
    opacity: 1;
    pointer-events: auto;
  }

  &__icon {
    // 视觉图标 36×36(icon_btn_cancel 旋转 45°:X → +)
    width: 36px;
    height: 36px;
    display: block;
    user-select: none;
    transform: rotate(45deg);
    // 与删除按钮一致的半透明 + hover 灰染样式
    opacity: 0.5;
  }

  &:hover .chat-plus__icon {
    filter: $icon-hover-gray-filter;
  }
}

// 当某条消息处于悬停态时,显示该条对应的"补头像"按钮
.chat-plus--visible {
  opacity: 1;
  pointer-events: auto;
}

// 编辑模式:消息头像可点击(非管理员消息,弹出底部角色头像菜单)
.chat-avatar--pickable {
  cursor: pointer;
}

// 编辑模式:角色名可点击进入内联改名。
// 全局 .chat-speaker-name 为 pointer-events:none(suspended 显示层),此处覆盖为可交互;
// hover 提亮提示"可编辑"(灰字 #b8b6b4 → 更亮 #e3e1e1)。
.chat-speaker-name--editable {
  pointer-events: auto;
  cursor: pointer;
  user-select: none;

  &:hover {
    color: $color-subcard-text;
  }
}

// 编辑态:原地变输入框(contenteditable),加下划线表明可输入;
// 文字颜色保持与显示态一致($color-speaker-name 灰),仅交互提示不同。
.chat-speaker-name--editing {
  pointer-events: auto;
  cursor: text;
  border-bottom: 1px solid $color-chat-frame;
  user-select: text;
}
</style>
