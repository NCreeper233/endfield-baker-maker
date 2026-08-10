<script setup lang="ts">
// =============================================================================
// 编辑模式面板:消息输入区(EditComposer)
// -----------------------------------------------------------------------------
// 职责(从 EditModePanel 壳拆出,聚焦输入相关):
//   1. contenteditable 输入框(表情以 <img> 内嵌,文本以 token 序列化)
//   2. 回车发送 / Ctrl/Cmd/Shift+Enter 换行 / 粘贴仅纯文本
//   3. 上传图片(隐藏 file input + 等比缩放到 CHAT_IMAGE 上限)
//   4. 三种发送动作:普通 / 选项 / 居中文本
//   5. 表情插入(供壳的表情弹窗调用)
// 设计理由:输入区与发送逻辑强耦合,按钮列与弹窗状态归壳;
//         壳通过 expose 触发 openFilePicker / sendNormal / sendOption /
//         sendCentered / insertEmoji,接口最小化。
// =============================================================================
import { ref } from 'vue'
import { CHAT_IMAGE } from '../../constants/design'
import { emojiImgHtml, htmlToEmojiText } from '../../constants/emoji'
import type { Emoji } from '../../constants/emoji'
import { useChatStore } from '../../stores/chat'

const chatStore = useChatStore()

/** 隐藏的图片文件选择框(上传图片按钮触发) */
const fileInput = ref<HTMLInputElement | null>(null)

/**
 * 选择图片后:读取为 dataURL,按自然尺寸等比计算显示尺寸(不超过 CHAT_IMAGE 上限,
 * 小图不放大),再作为纯图片消息直接发送(无气泡)。
 *
 * 读取完成后重置 input.value,允许连续选择同一文件。
 */
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result
    if (typeof dataUrl !== 'string') return
    const img = new Image()
    img.onload = () => {
      const nw = img.naturalWidth || CHAT_IMAGE.w
      const nh = img.naturalHeight || CHAT_IMAGE.h
      if (nw <= CHAT_IMAGE.w && nh <= CHAT_IMAGE.h) {
        chatStore.sendImage(dataUrl, nw, nh)
      } else {
        const scale = Math.min(CHAT_IMAGE.w / nw, CHAT_IMAGE.h / nh)
        chatStore.sendImage(dataUrl, Math.round(nw * scale), Math.round(nh * scale))
      }
      input.value = ''
    }
    img.onerror = () => {
      // 图片解码失败时打印警告并清空 input,让用户感知失败并可换图重试
      // (若静默清空,用户不知为何图片没发出去)。
      console.warn('[EditComposer] 图片解码失败,可能是损坏或不受支持的格式')
      input.value = ''
    }
    img.src = dataUrl
  }
  reader.readAsDataURL(file)
}

/** 输入框 DOM ref(contenteditable,表情以 <img> 内嵌,文本以 token 序列化) */
const inputEl = ref<HTMLDivElement | null>(null)

/**
 * 序列化输入框内容为 token 文本(表情 <img> → [sns_emoji_xxx])
 */
function serializeInput(): string {
  return inputEl.value ? htmlToEmojiText(inputEl.value.innerHTML) : ''
}

/** 清空输入框 */
function clearInput() {
  if (inputEl.value) inputEl.value.innerHTML = ''
}

/**
 * 点击表情:聚焦输入框并在光标处插入表情图(紧跟在文字后面)
 *
 * 表情输出**内联 em 尺寸**(高度 1em、宽度按原图宽高比),随输入框字号
 * 自动缩放且保持真实比例;contenteditable 中仅靠全局样式仍可能被浏览器
 * 按行高压扁,显式内联尺寸保证任何环境下都是真实比例的贴纸。
 *
 * 用 Range API 插入表情(`document.execCommand('insertHTML')` 已废弃,
 * 返回值在部分浏览器不可靠——可能返回 true 但 DOM 未实际修改):
 * - 有选区且在输入框内:删除选区内容 → 插入表情片段 → 光标移到表情后
 * - 无选区或选区不在输入框内:追加到输入框末尾
 */
function insertEmoji(emoji: Emoji) {
  const el = inputEl.value
  if (!el) return
  el.focus()
  const imgHtml = emojiImgHtml(emoji.token, emoji.src)
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const tmp = document.createElement('div')
    tmp.innerHTML = imgHtml
    const frag = document.createDocumentFragment()
    while (tmp.firstChild) frag.appendChild(tmp.firstChild)
    range.insertNode(frag)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  } else {
    el.insertAdjacentHTML('beforeend', imgHtml)
  }
}

/**
 * 键盘事件:
 * - Enter(无修饰键):发送
 * - Ctrl/Cmd/Shift + Enter:插入换行(消息内换行)
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    // 换行:以纯文本插入 \n,序列化时还原为换行符
    document.execCommand('insertText', false, '\n')
  } else {
    sendNormal()
  }
}

/** 粘贴:仅插入纯文本,避免脏 HTML 破坏输入框结构(表情请从面板重新选择) */
function onPaste(event: ClipboardEvent) {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  document.execCommand('insertText', false, text)
}

/** 发送普通消息(最右按钮 / 回车触发),发送后清空输入 */
function sendNormal() {
  chatStore.sendMessage(serializeInput(), false)
  clearInput()
}

/** 以选项方式发送(第 2 个按钮触发):消息以我方身份发送并携带 choices */
function sendOption() {
  chatStore.sendMessage(serializeInput(), true)
  clearInput()
}

/** 以居中提示文本发送(第 3 个按钮触发):无气泡 / 无角色归属,水平居中 */
function sendCentered() {
  chatStore.sendCenteredMessage(serializeInput())
  clearInput()
}

/** 以分段矩形面板发送(第 1 个按钮触发):固定尺寸圆角 #2a2a2a 矩形,无归属居中。
 * 不发送输入框内容,面板内固定生成两行默认文案"任务名称/任务地点",
 * 插入后进入编辑模式可修改。发送后**保留**输入框文字(与普通发送不同,
 * 任务面板不消费输入内容,清空会打断用户连续创作)。 */
function sendPanel() {
  chatStore.sendPanelMessage('任务名称\n任务地点')
}

/** 暴露给壳:上传图片按钮触发文件选择 */
defineExpose({
  openFilePicker() {
    fileInput.value?.click()
  },
  insertEmoji,
  sendNormal,
  sendOption,
  sendCentered,
  sendPanel,
})
</script>

<template>
  <input
    ref="fileInput"
    class="edit-panel__file"
    type="file"
    accept="image/*"
    @change="onFileChange"
  />
  <div
    ref="inputEl"
    class="edit-panel__input"
    contenteditable="true"
    role="textbox"
    aria-label="发消息输入框"
    data-placeholder="发消息"
    @keydown="onKeydown"
    @paste="onPaste"
  ></div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

// 隐藏的图片选择框(上传图片按钮触发)
.edit-panel__file {
  display: none;
}

// 胶囊输入框:占满左端空白,高 45px 与按钮同高;
// contenteditable div:表情以 <img> 内嵌(1em 高,随字号);占位符用 :empty::before;
// 支持消息内换行(Ctrl/Cmd/Shift+Enter),多行时内部纵向滚动
.edit-panel__input {
  flex: 1;
  min-width: 0;
  height: 45px;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-x: hidden;
  overflow-y: auto;
  border: none;
  border-radius: 999px;
  background: $color-btn-bg;
  color: #2a2a2a;
  font-family: $font-bubble;
  font-size: 20.88px;
  padding: 8px 24px;
  box-sizing: border-box;
  outline: none;
  user-select: text;
  word-break: break-word;
  scrollbar-width: none;
  // 面板不拦截事件,但输入框自身需可交互
  pointer-events: auto;

  // 占位符(contenteditable 无 placeholder 属性,用 data-placeholder + :empty)
  &:empty::before {
    content: attr(data-placeholder);
    color: rgba(42, 42, 42, 0.5);
    pointer-events: none;
    user-select: none;
  }
}
</style>
