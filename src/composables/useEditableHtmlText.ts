// =============================================================================
// useEditableHtmlText:contenteditable 文本编辑逻辑(表情 token <-> <img>)
// -----------------------------------------------------------------------------
// 聊天气泡(ChatBubble)与居中提示文本(ChatCenteredText)共用同一套
// contenteditable 编辑行为:DOM 手动设置 innerHTML(避免 props 变化干扰光标)、
// 失焦对比初始快照、空内容回退、Enter/Escape 提交、粘贴净化。
//
// 用法(组件内):
//   - textRef:文本 DOM ref
//   - getText(): 当前 props.text(编辑模式仅用于初始快照,不参与 measure)
//   - getEditable(): 是否编辑模式
//   - emitInput / emitUpdate: input(实时)与 update:text(失焦持久化)回调
//
// 组件模板复用返回值绑定 contenteditable 的事件;生命周期(Vue watch/
// onMounted)全部由此 composable 内部管理,组件无需重复。
// =============================================================================

import { nextTick, onMounted, ref, watch, type Ref } from 'vue'
import { emojiToHtml, htmlToEmojiText } from '../constants/emoji'

interface EditableHtmlTextOptions {
  /** 文本 DOM ref(contenteditable 目标) */
  textRef: Ref<HTMLDivElement | null>
  /** 读取当前文本(编辑模式仅作为初始 DOM 快照) */
  getText: () => string
  /** 当前是否为编辑模式 */
  getEditable: () => boolean
  /** 编辑过程中的实时回调(input 事件,用于驱动父组件实时测量) */
  emitInput: (text: string) => void
  /** 失焦持久化回调(内容与初始值不同时触发) */
  emitUpdate: (text: string) => void
  /** 播放模式文本渲染(默认 emojiToHtml)。需要额外结构/内联样式时传入,
   *  如 ChatPanel 把首行包进 span 以保留两行字号/透明度差异(html-to-image
   *  不克隆 ::first-line,伪元素样式无法进入导出图) */
  renderPlay?: (text: string) => string
}

/**
 * 挂载 contenteditable 编辑逻辑(组件 setup 顶层调用一次)
 *
 * 内部管理:
 * - onMounted / watch(editable):编辑模式下用 DOM 设置初始 innerHTML + 快照
 * - watch(text):非编辑模式下 props.text 变化同步到 DOM
 * - onTextInput / onTextBlur / onTextKeydown / onTextPaste:事件处理器
 */
export function useEditableHtmlText(options: EditableHtmlTextOptions) {
  const { textRef, getText, getEditable, emitInput, emitUpdate } = options

  /** 编辑模式:挂载时的初始显示文本快照(供 onTextBlur 判断是否实际修改) */
  const initialText = ref('')

  /** 用 DOM 设置文本(编辑模式不用 {{ }} 绑定,避免 Vue 重渲染干扰光标) */
  function setDomHtml(html: string) {
    if (textRef.value) textRef.value.innerHTML = html
  }

  function setInitial() {
    const t = getText()
    // 编辑模式初始 innerHTML 也走 renderPlay(若提供),让 ChatPanel 在编辑态
    // 也保留两行字号/透明度差异。htmlToEmojiText 会剥离 span 标签只取文本,
    // onTextInput/onTextBlur 不受影响。
    const render = options.renderPlay ?? emojiToHtml
    setDomHtml(render(t))
    initialText.value = t
  }

  // 挂载时:编辑模式用 DOM 操作设置初始 innerHTML + 快照;非编辑模式由模板 v-html 控制
  onMounted(() => {
    if (getEditable()) setInitial()
  })

  // 非编辑模式下,props.text 变化时同步到 DOM(编辑模式不监听,避免重置光标)
  watch(
    () => getText(),
    (newText) => {
      if (!getEditable()) {
        const render = options.renderPlay ?? emojiToHtml
        setDomHtml(render(newText ?? ''))
      }
    },
  )

  // 播放模式 → 编辑模式:模板清空 div 后需重新设置 innerHTML + initialText
  // (必须 nextTick 延迟到 Vue 完成 DOM 更新,否则先设置又被模板清空)
  watch(
    () => getEditable(),
    (editable) => {
      if (editable) nextTick(setInitial)
    },
  )

  /**
   * 'input' 事件:实时触发(每键)
   *
   * emit 给父组件更新本地缓存,驱动实时测量;不直接写 store。
   */
  function onTextInput(event: Event) {
    const target = event.target as HTMLElement
    // innerText 不含 <img>,用 innerHTML 序列化还原表情 token
    emitInput(htmlToEmojiText(target.innerHTML))
  }

  /**
   * contenteditable 失焦:对比初始快照,按需持久化
   *
   * - 未修改就失焦:newText === initial,不 emit(避免把 fallback 文本误写入 store)
   * - 清空输入:恢复 DOM 为 initial,同步本地缓存,不持久化空字符串
   * - 修改且 !== initial:emit 持久化
   */
  function onTextBlur(event: FocusEvent) {
    const target = event.target as HTMLElement
    const newText = htmlToEmojiText(target.innerHTML)
    const initial = initialText.value

    if (!newText) {
      // 清空恢复:同样走 renderPlay 保持编辑态样式一致
      const render = options.renderPlay ?? emojiToHtml
      setDomHtml(render(initial))
      emitInput(initial)
      return
    }

    if (newText !== initial) {
      emitUpdate(newText)
    }
  }

  /**
   * 键盘事件
   * - Enter(无 Shift):阻止换行 + 失焦提交
   * - Escape:失焦提交
   */
  function onTextKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      ;(event.target as HTMLElement).blur()
    } else if (event.key === 'Escape') {
      ;(event.target as HTMLElement).blur()
    }
  }

  /**
   * 粘贴仅插入纯文本,避免脏 HTML 混入 DOM
   *
   * 用 Selection/Range API:删除选区内容 → 插入文本节点 → 光标移到
   * 文本末尾 → 触发 input 事件以更新父组件 localTexts。
   * 不依赖 `document.execCommand('insertText', ...)`(已被 WHATWG 标记为
   * 废弃,旧版 iOS Safari 等移动端 WebView 可能静默失败)。
   * 无选区时不插入(理论上 contenteditable 聚焦时总有选区,缺省即不操作)。
   */
  function onTextPaste(event: ClipboardEvent) {
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    // 把选区移到新插入文本之后,浏览器会触发 input 事件(同步走 onTextInput)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  return { onTextInput, onTextBlur, onTextKeydown, onTextPaste }
}