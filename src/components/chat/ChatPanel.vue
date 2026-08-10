<script setup lang="ts">
// 由编辑模式底部面板"任务面板"按钮(icon_decorate_task_1.png)插入。
// 渲染为固定尺寸(1089×78)的圆角 #2a2a2a 矩形,水平居中于聊天区:
//   - 无头像、无角色归属,与居中提示文本同性质
// - 边框由 SCSS 渐变绘制(替代原 deco_sns_hudentry_bg.png 图片):
//     四条 1~2px 发丝细线 + 每边差异化亮度模拟光照,贴合面板四边
//     面板本身尺寸/圆角/底色保持不变
//   - 当前 text 恒为空(纯色块);组件已预留文本框槽,后续可承载文案
//   - 编辑模式:text 非空时 contenteditable 可直接改字(逻辑与 ChatCenteredText 一致)
//   - 自动播放:静默出现(loadingSide 返回 null,不显示 LoadingBubble)
// =============================================================================
import { computed, ref } from 'vue'
import { type BubbleBox } from '../../utils/measure'
import { CHAT_PANEL } from '../../constants/design'
import { MATERIALS } from '../../constants/materials'
import { emojiToHtml } from '../../constants/emoji'
import { useEditableHtmlText } from '../../composables/useEditableHtmlText'

const props = defineProps<{
  /** 面板内文案(当前默认空串;用于 measure/编辑时初始填充) */
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
  /** 左端图标下标(char/activity/fac 三选一,存于消息上供导出共享) */
  panelIcon?: number
  /** 左端竖条颜色下标(三色循环,存于消息上供导出共享) */
  panelBarColor?: number
  /** 右端装饰是否切换为第二张(存于消息上供导出共享) */
  panelDecoAlt?: boolean
}>()

/** emit:
 * - 'input':编辑过程中实时触发(不写 store,只通知父组件更新 localTexts)
 * - 'update:text':失焦时触发(写 store,持久化)
 * - 'update:style':点击切换面板样式时触发(写 store,持久化)
 */
const emit = defineEmits<{
  (e: 'update:text', text: string): void
  (e: 'input', text: string): void
  (e: 'update:style', style: Partial<{ panelIcon: number; panelBarColor: number; panelDecoAlt: boolean }>): void
}>()

/** 文本 DOM ref(编辑模式下用 DOM 操作设置文本,不用 {{ text }} 绑定,
 *  避免 props.text 变化时 Vue 重渲染干扰 contenteditable 光标) */
const textRef = ref<HTMLDivElement | null>(null)

/**
 * 播放模式渲染:面板内两行文案字号/透明度不同——第一行(任务名称)更大更亮,
 * 其余行(任务地点)较小且更淡。
 *
 * 不用 ::first-line:html-to-image 只克隆 ::before/::after,伪元素样式无法进入
 * 导出图。把首行包进带内联样式的 span,导出时内联样式可被完整保留,
 * 两行差异在导出的图片中依然可见。
 */
const PANEL_FIRST_LINE_STYLE = 'color: rgba(255, 255, 255, 0.8); font-size: 23px;'
const PANEL_REST_LINE_STYLE = 'color: rgba(255, 255, 255, 0.3); font-size: 20px;'

/** 播放模式文案 HTML:首行(任务名称)用第一行样式,其余内容沿用面板默认样式 */
function renderPanelText(text: string): string {
  const nl = text.indexOf('\n')
  const firstLine = nl < 0 ? text : text.slice(0, nl)
  const rest = nl < 0 ? '' : text.slice(nl + 1)
  const firstHtml = emojiToHtml(firstLine)
  if (!rest) return `<span style="${PANEL_FIRST_LINE_STYLE}">${firstHtml}</span>`
  const restHtml = emojiToHtml(rest)
  return `<span style="${PANEL_FIRST_LINE_STYLE}">${firstHtml}</span>\n<span style="${PANEL_REST_LINE_STYLE}">${restHtml}</span>`
}

/** 挂载 contenteditable 编辑逻辑(初始快照 / 失焦持久化 / 键盘 / 粘贴) */
const { onTextInput, onTextBlur, onTextKeydown, onTextPaste } = useEditableHtmlText({
  textRef,
  getText: () => props.text ?? '',
  getEditable: () => !!props.editable,
  emitInput: (text) => emit('input', text),
  emitUpdate: (text) => emit('update:text', text),
  renderPlay: renderPanelText,
})

/** 面板样式:固定尺寸圆角矩形,底色纯 #2a2a2a */
const panelStyle = computed(() => ({
  left: `${props.left}px`,
  top: `${props.top}px`,
  width: `${CHAT_PANEL.w}px`,
  height: `${CHAT_PANEL.h}px`,
  borderRadius: '6px', // 四角统一 6px
  backgroundColor: '#2a2a2a',
}))

/** 是否有文案内容(渲染 title 槽位;当前恒为 false) */
const hasText = computed(() => !!props.text)

/** 右端装饰图二选一切换:false=21(默认) / true=20,点击右端互换 */
const decoAlt = computed(() => !!props.panelDecoAlt)
const decoSource = computed(() =>
  decoAlt.value ? MATERIALS.chatPanelDecoAlt : MATERIALS.chatPanelDeco,
)
/** 点击右端装饰区:两张图互相替换(仅编辑模式,样式存于消息,供导出共享) */
function toggleDeco(): void {
  if (!props.editable) return
  emit('update:style', { panelDecoAlt: !decoAlt.value })
}

/** 左端竖条颜色循环:#8ddafd → #bbff3f → #ffef00 → 回到第一个 */
const barColors = ['#8ddafd', '#bbff3f', '#ffef00'] as const
const barColorIndex = computed(() => props.panelBarColor ?? 0)
// 旧数据 / 损坏数据可能传入负数,% 对负数返回负值,
// barColors[负数] = undefined 导致样式塌陷。统一用 ((n % len) + len) % len
// 把负数折回正区间。
function safeMod(n: number, len: number): number {
  return ((n % len) + len) % len
}
const barColor = computed(() => barColors[safeMod(barColorIndex.value, barColors.length)])
/** 点击左端竖条:切换下一种颜色(仅编辑模式,样式存于消息,供导出共享) */
function cycleBarColor(): void {
  if (!props.editable) return
  emit('update:style', { panelBarColor: (barColorIndex.value + 1) % barColors.length })
}

/** 左端图标三选一循环:char → activity → fac(shadow) → 回到第一个 */
const panelIcons = [
  MATERIALS.chatPanelIcon,
  MATERIALS.chatPanelIconAlt,
  MATERIALS.chatPanelIconAlt2,
] as const
const panelIconIndex = computed(() => props.panelIcon ?? 0)
const panelIconSource = computed(() => panelIcons[safeMod(panelIconIndex.value, panelIcons.length)])
/** 点击左端图标:切换下一种图标(仅编辑模式,样式存于消息,供导出共享) */
function cyclePanelIcon(): void {
  if (!props.editable) return
  emit('update:style', { panelIcon: (panelIconIndex.value + 1) % panelIcons.length })
}
</script>

<template>
<div
    class="chat-panel"
    :class="{ 'chat-panel--play': !editable }"
    :style="panelStyle"
  >
    <span
      class="chat-panel__border"
      aria-hidden="true"
    ></span>
    <span
      class="chat-panel__bar"
      :class="{ 'is-editable': editable }"
      :style="{ backgroundColor: barColor }"
      @click="cycleBarColor"
    ></span>
    <div
      class="chat-panel__icon-group"
    >
      <img
        class="chat-panel__icon"
        :class="{ 'is-editable': editable }"
        :src="panelIconSource"
        alt=""
        @click="cyclePanelIcon"
      />
      <span
        class="chat-panel__icon-divider"
        aria-hidden="true"
      ></span>
    </div>
    <img
      class="chat-panel__deco"
      :class="{ 'is-editable': editable }"
      :src="decoSource"
      alt=""
      @click="toggleDeco"
    />
    <!-- 切换态(decoAlt)右端白色圆形(替代 bg_sns_tweet_decorate_20.webp 中的圆形):
         用 SVG 几何图元(circle)替代 radial-gradient,获得子像素反走样,消除锯齿。
         中心实心(r≤20)+ 中间挖空环(20<r<22)+ 外圈白(22≤r≤25),
         通过 fill-rule:evenodd 复合 path 实现 -->
    <svg
      v-if="decoAlt"
      class="chat-panel__deco-circle"
      viewBox="0 0 50 50"
      aria-hidden="true"
    >
      <defs>
        <filter id="decoCircleShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.35" />
        </filter>
      </defs>
      <!-- 复合 path:中心实心(r≤20)+ 中间挖空环(20<r<22)+ 外圈白(22≤r≤25)
           fill-rule:evenodd 自然形成挖空环;整体加阴影(阴影只在外缘可见,
           中心圆被外圈包围,阴影不可见) -->
      <path
        d="M25,25 m-25,0 a25,25 0 1,0 50,0 a25,25 0 1,0 -50,0
           M25,25 m-22,0 a22,22 0 1,1 44,0 a22,22 0 1,1 -44,0
           M25,25 m-20,0 a20,20 0 1,0 40,0 a20,20 0 1,0 -40,0"
        fill="#fff"
        fill-rule="evenodd"
        filter="url(#decoCircleShadow)"
      />
      <!-- 中心 ">" 形状:顶点在圆心,两条线段向右开口 -->
      <path
        d="M21,17 L31,25 L21,33"
        fill="none"
        stroke="#232323"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span
      class="chat-panel__overlay"
      aria-hidden="true"
    ></span>
    <div
      v-if="hasText"
      ref="textRef"
      class="chat-panel__text"
      :class="{ 'is-editable': editable, 'is-play': !editable }"
      :contenteditable="editable ? 'true' : 'false'"
      @blur="editable && onTextBlur($event)"
      @keydown="editable && onTextKeydown($event)"
      @input="editable && onTextInput($event)"
      @paste="editable && onTextPaste($event)"
      v-html="editable ? undefined : renderPanelText(text ?? '')"
    ></div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

.chat-panel {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  // 面板四周阴影:柔和扩散,与聊天气泡阴影统一观感
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35));
  // 播放模式入场:淡入 + 轻微上浮(与 centered-in 同节奏)
  &.chat-panel--play {
    animation: centered-in $anim-chat-in ease backwards;
  }

  // 边框图层(替代原 deco_sns_hudentry_bg.png):2px 发丝细线圆角边框,
  // 位于面板矩形之下、外扩 2px 贴合面板四边;圆角 14px 与面板圆角(12px)同心,
  // 边框内侧恰好落在面板圆弧上,四角完美包住无缝隙。
  &__border {
    position: absolute;
    left: -2px;
    top: -2px;
    width: calc(100% + 4px);
    height: calc(100% + 4px);
    border-radius: 8px; // 微调后的边框圆角
    border: 3px solid rgba(204, 204, 204, 0.3);
    // 每边差异化亮度模拟光照:顶边中亮 / 底边最亮 / 左暗右亮
    border-top-color: rgba(204, 204, 204, 0.28);
    border-bottom-color: rgba(204, 204, 204, 0.55);
    border-left-color: rgba(204, 204, 204, 0.22);
    border-right-color: rgba(204, 204, 204, 0.45);
    pointer-events: none;
    user-select: none;
    z-index: 2;
  }

  // 最左端竖条:高与面板一致、宽 6px。
  // z-index: 1,置于边框(2)之下、矩形背景之上,可见于矩形表面。
  // 左端上下圆角与边框(8px)一致,不盖住边框圆角。
  // 颜色由点击事件在 #8ddafd / #bbff3f / #ffef00 间循环(绑定于内联样式)。
  &__bar {
    position: absolute;
    left: 0;
    top: 0;
    width: 6px;
    height: 100%;
    border-radius: 8px 0 0 8px;
    user-select: none;
    z-index: 1;
    // 仅编辑模式显示手型光标,播放模式虽 cycleBarColor 内有 editable 守卫
    // 立即返回,但 cursor: pointer 仍会误导用户以为可点击。
    cursor: default;
    &.is-editable {
      cursor: pointer;
    }
  }

  // 左端图标组(char/activity/fac 三色切换):贴左(右移30px)、上下居中,等比缩小。
  // 图标右侧跟一条等高的半透明竖线(与图标同透明数值),点击图标切换内容。
  &__icon-group {
    position: absolute;
    left: 30px;
    top: 50%;
    transform: translateY(-50%);
    height: 65%;
    display: flex;
    align-items: center;
    z-index: 2;
    pointer-events: none;
  }

  &__icon {
    height: 100%;
    width: auto;
    object-fit: contain;
    opacity: 0.3;
    pointer-events: auto;
    user-select: none;
    // 仅编辑模式显示手型,播放模式 cyclePanelIcon 内有 editable 守卫
    cursor: default;
    &.is-editable {
      cursor: pointer;
    }
  }

  // 分割线绝对定位(30px + 图标默认宽≈53.5px + 间距≈-5.5px ≈ 78px):
  // 与图标宽度解耦,切换任何图标图片其位置/尺寸都恒定不变。
  &__icon-divider {
    position: absolute;
    left: 78px;
    top: 50%;
    transform: translateY(-50%);
    width: 2px;
    height: 38px;
    background-color: rgba(255, 255, 255, 0.3);
    user-select: none;
  }

  // 右端装饰图(bg_sns_tweet_decorate_21.png,700×100):等比缩小到面板高度,
  // 长边贴齐右侧、垂直居中,不拉伸不变形。
  // 原图为白色单色装饰,与选中态按钮(deco_map_custom_mark_delete_write.png
  // is-selected)同思路用 brightness 压暗为纯黑色,255 × 0 = 0。
  // 可点击:在 21 与 20 两张装饰图间互相替换。
  &__deco {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 100%; // 78px(等比缩放,宽≈546px)
    width: auto;
    object-fit: cover;
    // 与 bg_sns_tweet_decorate_21 四角一致的圆角(按显示比例折算):
    // r≈t/1.707 → TL≈15px、TR≈6px、BR≈6px、BL≈6px
    border-radius: 15px 6px 6px 6px;
    filter: brightness(0);
    // 仅编辑模式显示手型,播放模式 toggleDeco 内有 editable 守卫
    cursor: default;
    user-select: none;
    z-index: 2;
    &.is-editable {
      cursor: pointer;
    }
  }

  // 切换态右端白色圆形(替代 bg_sns_tweet_decorate_20.webp 中的圆形):
  // 直径 50px,垂直居中,贴装饰图右端内缩 20px;层级高于装饰图与遮罩。
  // 用 SVG 几何图元(circle path)替代 radial-gradient:浏览器对几何图元
  // 做子像素反走样,边缘平滑;radial-gradient 硬透明边界无反走样,锯齿明显。
  // 中心实心(r≤20)+ 中间挖空环(20<r<22)+ 外圈白(22≤r≤25)
  &__deco-circle {
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    width: 50px;
    height: 50px;
    overflow: visible;
    pointer-events: none;
    user-select: none;
    z-index: 3;
  }

  // 半白色遮罩:位于装饰图之上,从右边缘向左侧 415px 内渐变为全透明
  &__overlay {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0) calc(100% - 415px),
      rgba(255, 255, 255, 0.5) 100%
    );
    // 遮罩整体透明度降低(原 1.0 → 0.7)
    opacity: 0.7;
    border-radius: inherit;
    pointer-events: none;
    user-select: none;
    z-index: 2;
  }

  &__text {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    // 左对齐:起点位于左端图标组(30px + 图标宽≈53.5px + 间距25px ≈ 108.5px
    // 即细条位置)再往右 15px 处
    left: 123.5px;
    z-index: 3;
    text-align: left;
    font-family: $font-bubble;
    // 面板内两行文案字号不同:
    //   - 第一行(任务名称):比气泡文字更大(由 renderPanelText 内 inline span 实现)
    //   - 第二行(任务地点):比第一行小但仍醒目
    // 第二行透明度与左端图标(activity_mission_icon_gray.png,opacity 0.3)一致:
    // 底色置为半透明白(等效白字 30% 不透明),第一行由 renderPanelText 内的
    // <span style="color: rgba(255,255,255,0.8); font-size: 23px;"> 包裹恢复
    // 第一行样式由 renderPanelText 内的 inline span 实现(色值/字号直接写在
    // 内联 style 中):不依赖 ::first-line 伪元素——该伪元素对 inline span 内
    // 文本不生效,且会被内联 style 优先级覆盖。
    color: rgba(255, 255, 255, 0.3);
    font-size: 20px;
    line-height: 1.44;
    white-space: pre-line;
    word-break: break-word;
    user-select: text;
    outline: none;

    // 编辑模式:可点击聚焦、显示光标
    &.is-editable {
      cursor: text;
      pointer-events: auto;

      &:focus {
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
        border-radius: 4px;
      }
    }

    // 播放模式:不拦截事件(点击穿透)
    &.is-play {
      pointer-events: none;
    }
  }
}
</style>