<script setup lang="ts">
// =============================================================================
// 居中提示文本(无气泡 / 无角色归属)
// -----------------------------------------------------------------------------
// 由编辑模式底部面板"居中文本"按钮(icon_btn_lv3_warn.png)发送。
// 渲染为居中纯白小号文本(比气泡字号小):
//   - 无气泡、无头像、无角色归属
//   - 编辑模式:contenteditable 可直接改字(逻辑与 ChatBubble 完全一致)
//   - 自动播放:静默出现(loadingSide 返回 null,不显示 LoadingBubble)
// =============================================================================
import { computed, onMounted, ref } from 'vue'
import { type BubbleBox } from '../../utils/measure'
import { CHAT_SCROLL } from '../../constants/design'
import { useCanvasZoom } from '../../composables/useCanvasZoom'
import { emojiToHtml } from '../../constants/emoji'
import { useEditableHtmlText } from '../../composables/useEditableHtmlText'

const props = defineProps<{
  /** 消息文本(编辑模式仅用于初始填充 DOM,不用于 measure) */
  text?: string
  /** 尺寸测量结果(由父组件 ChatArea 统一 measure 后传入) */
  box: BubbleBox
  /** 左上角 x(相对 .chat-scroll 内坐标) */
  left: number
  /** 左上角 y(相对 .chat-scroll 内坐标) */
  top: number
  /** 是否可编辑(编辑模式) */
  editable?: boolean
  /** 消息 id(编辑模式用于 emit 时回传) */
  messageIndex?: number
}>()

/** emit:
 * - 'input':编辑过程中实时触发(不写 store,只通知父组件更新 localTexts,用于实时 measure)
 * - 'update:text':失焦时触发(写 store,持久化)
 */
const emit = defineEmits<{
  (e: 'update:text', text: string): void
  (e: 'input', text: string): void
}>()

/** 文本 DOM ref(编辑模式下用 DOM 操作设置文本,不用 {{ text }} 绑定,
 *  避免 props.text 变化时 Vue 重渲染干扰 contenteditable 光标) */
const textRef = ref<HTMLDivElement | null>(null)

/** 挂载 contenteditable 编辑逻辑(初始快照 / 失焦持久化 / 键盘 / 粘贴) */
const { onTextInput, onTextBlur, onTextKeydown, onTextPaste } = useEditableHtmlText({
  textRef,
  getText: () => props.text ?? '',
  getEditable: () => !!props.editable,
  emitInput: (text) => emit('input', text),
  emitUpdate: (text) => emit('update:text', text),
})

// ---- 整条贯穿线 --------------------------------------------------------------
// 居中提示文本左右各一段纯白细线,两端各距聊天框边缘 30px,与文字垂直居中:
//   - 左段:距左缘 30px → 文字左端 - 25px 留白
//   - 右段:文字右端 + 25px 留白 → 距右缘 30px
// ----------------------------------------------------------------------------
const BAR_H = 3
const BAR_GAP_TEXT = 25
const BAR_GAP_EDGE = 30

/** 画布等比缩放系数(DesignCanvas 用 zoom 缩放整张设计稿) */
const { scale } = useCanvasZoom()

/** 组件已挂载标记:挂载前 textRef 为 null,先不采样;挂载后触发重渲染以对齐像素 */
const ready = ref(false)
onMounted(() => {
  ready.value = true
})

/**
 * 把 .chat-scroll 内的 css 纵坐标对齐到整数设备像素。
 *
 * 居中横线是 3px 细线,而整张画布被非整数 `zoom` 等比缩放,chat-scroll 自身
 * 又位于小数坐标 origin(CHAT_SCROLL.x/y)上:若上下边各自独立取整,两整数之差
 * 会随每行 midY 的小数部分在相邻整数设备像素间摇摆,导致有的线 2px、有的 3px。
 * 这里先固定一个"全行一致的整数设备像素线厚",再只把上边对齐到设备像素,保证
 * 所有行线厚绝对一致、边缘锐利。
 *
 * 用 computed 计算,依赖 scale/ready/props.top/props.box.rectH:
 *   - 模板内 `:style` 通过 computed 建立响应式依赖追踪,scale 变化(resize)时
 *     自动触发重渲染,横线位置/厚度保持对齐。
 *   - computed 结果有缓存,多次读取不重复触发 getBoundingClientRect 强制造价。
 */
const barGeometry = computed(() => {
  const midY = props.top + props.box.rectH / 2
  const zoom = scale.value || 1
  if (!ready.value) return { top: midY - BAR_H / 2, height: BAR_H }
  const scrollEl = textRef.value?.closest('.chat-scroll')
  const base = scrollEl ? scrollEl.getBoundingClientRect().top : 0
  // 设备线厚:约 3px×zoom 向上取整,跨行恒为同一整数设备像素
  const thickDev = Math.max(1, Math.round(BAR_H * zoom))
  const topDev = Math.round(base + (midY - BAR_H / 2) * zoom)
  return { top: (topDev - base) / zoom, height: thickDev / zoom }
})

/** 左段横线样式(容器左缘 + 30px → 文字左端 - 25px) */
const leftBarStyle = computed(() => {
  const { top, height } = barGeometry.value
  const x1 = BAR_GAP_EDGE
  const x2 = props.left - BAR_GAP_TEXT
  return {
    left: `${x1}px`,
    top: `${top}px`,
    width: `${Math.max(0, x2 - x1)}px`,
    height: `${height}px`,
  }
})

/** 右段横线样式(文字右端 + 25px → 容器右缘 - 30px) */
const rightBarStyle = computed(() => {
  const { top, height } = barGeometry.value
  const x1 = props.left + props.box.rectW + BAR_GAP_TEXT
  const x2 = CHAT_SCROLL.w - BAR_GAP_EDGE
  return {
    left: `${x1}px`,
    top: `${top}px`,
    width: `${Math.max(0, x2 - x1)}px`,
    height: `${height}px`,
  }
})
</script>

<template>
  <!-- ready 翻转前不渲染横线,避免首帧(未对齐值)到第二帧(对齐值)的
       位置跳变:横线仅在 ready 为真时渲染,v-if="ready" 让首帧不画线。 -->
  <div
    v-if="ready"
    class="chat-centered-bar"
    :class="{ 'chat-centered-bar--play': !editable }"
    :style="leftBarStyle"
  />
  <div
    ref="textRef"
    class="chat-centered"
    :class="{ 'is-editable': editable, 'is-play': !editable }"
    :style="{
      left: `${left}px`,
      top: `${top}px`,
      width: `${box.rectW}px`,
      height: `${box.rectH}px`,
    }"
    :contenteditable="editable ? 'true' : 'false'"
    @blur="editable && onTextBlur($event)"
    @keydown="editable && onTextKeydown($event)"
    @input="editable && onTextInput($event)"
    @paste="editable && onTextPaste($event)"
    v-html="editable ? undefined : emojiToHtml(text ?? '')"
  ></div>
  <div
    v-if="ready"
    class="chat-centered-bar"
    :class="{ 'chat-centered-bar--play': !editable }"
    :style="rightBarStyle"
  />
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

.chat-centered-bar {
  position: absolute;
  background: rgba(255, 255, 255, 0.5);
  pointer-events: none;
  user-select: none;

  // 播放模式入场:淡入 + 轻微上浮(与 chat-in 同节奏)
  &.chat-centered-bar--play {
    animation: centered-in $anim-chat-in ease backwards;
  }
}

.chat-centered {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-family: $font-bubble;
  font-size: $font-size-bubble;
  line-height: 1.5;
  white-space: pre-line;
  word-break: break-word;
  user-select: text;

  // 播放模式入场:淡入 + 轻微上浮(与 chat-in 同节奏)
  &.is-play {
    animation: centered-in $anim-chat-in ease backwards;
  }

  // 编辑模式:可点击聚焦、显示光标
  &.is-editable {
    cursor: text;
    pointer-events: auto;
    outline: none;

    &:focus {
      // 聚焦时显示淡淡的边框提示(与气泡一致)
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
      border-radius: 4px;
    }
  }
}
</style>