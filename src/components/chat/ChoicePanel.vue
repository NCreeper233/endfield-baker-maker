<script setup lang="ts">
// =============================================================================
// 玩家选择面板
// -----------------------------------------------------------------------------
// 触发时机:useAutoPlay 预判到"玩家选择点组"时,
//          设置 store.pendingChoice = { messages: 组内消息 },本面板 v-if 渲染。
//
// 布局:贴在 chat-area 底部,高 720px,背景 #3c3b39,
//      内含若干白色胶囊形按钮(选项),点击后调用 store.submitChoice。
//
// 选项组:组内所有消息的 choices 摊平渲染为一个面板,
//        每个选项携带来源消息 id(sourceMsgId),提交时写回对应覆盖表。
//
// 扩展兼容:
//   - 选项数据来自 pendingChoice.messages(支持任意数量 / 任意组内消息数)
//   - 后续可扩展 condition 过滤、分支跳转等(在 PlayerChoice 类型预留)
// =============================================================================
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '../../stores/chat'
import { panelHeight as calcPanelHeight, panelTop as calcPanelTop } from '../../constants/panel'
import { measureTextWithEmoji, emojiToHtml } from '../../constants/emoji'
import type { PlayerChoice } from '../../types/chat'
import PanelTopMask from './PanelTopMask.vue'
import PanelShell from './PanelShell.vue'

const chatStore = useChatStore()
const { pendingChoice } = storeToRefs(chatStore)

/** 摊平后的选项(携带来源消息 id,空数组时面板不渲染,由 v-if 控制) */
interface FlatChoice extends PlayerChoice {
  sourceMsgId: number
}

const choices = computed<FlatChoice[]>(() =>
  pendingChoice.value?.messages.flatMap((m) =>
    (m.choices ?? []).map((c) => ({ ...c, sourceMsgId: m.id })),
  ) ?? [],
)

/** 面板高度(px):随选项数动态调整(共享公式,与 ChatArea 预留一致) */
const panelHeight = computed(() => calcPanelHeight(choices.value.length))

/** 面板顶 = detail 底边 - 面板高 - 3px(共享公式,与编辑模式面板一致) */
const panelTop = computed(() => calcPanelTop(panelHeight.value))

/**
 * 按钮可用文字宽度(按钮 770 - 左右 padding 40×2 = 690)
 * 为 "..." 预留 3 个字符宽度,避免贴边
 */
const BTN_MAX_W = 770 - 40 * 2

/**
 * 用 canvas 测量文本在指定字体下的实际像素宽度
 *
 * 复用同一个 canvas 实例避免重复创建;字体串需与 CSS 一致。
 * 表情 token 按真实渲染宽展开为空格后测量(异形表情不低估)。
 */
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
const measureCtx = measureCanvas?.getContext('2d') ?? null
const MEASURE_FONT = '500 22px "HarmonyOS Sans SC Medium"'

function measureText(text: string): number {
  if (!measureCtx) return text.length * 22
  measureCtx.font = MEASURE_FONT
  return measureTextWithEmoji(measureCtx, text)
}

/**
 * 按可用宽度裁剪文本,超长末尾加 "..."
 *
 * 算法:先整段测,若超宽则二分定位最大字符数,再加 "..."。
 * 不动 CSS 盒模型,纯渲染前裁剪。
 */
function ellipsisText(text: string): string {
  if (measureText(text) <= BTN_MAX_W) return text
  // 预留 "..." 宽度(粗略按 3 字符 × 0.6 字宽估)
  const ellipsisW = measureText('...')
  const limit = BTN_MAX_W - ellipsisW
  if (limit <= 0) return '...'
  // 二分查找最大字符数
  let lo = 1
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measureText(text.slice(0, mid)) <= limit) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.slice(0, lo) + '...'
}

/** 当前选项裁剪后的 label(渲染前预处理,不影响 CSS 盒模型) */
const displayChoices = computed(() =>
  choices.value.map((c) => {
    const label = ellipsisText(c.label)
    return { ...c, label, labelHtml: emojiToHtml(label) }
  }),
)

/**
 * 点击选项:提交选择并恢复播放
 *
 * @param choice 玩家点击的选项(携带来源消息 id)
 */
function onClick(choice: FlatChoice) {
  chatStore.submitChoice(choice.sourceMsgId, choice)
}
</script>

<template>
  <!-- 面板壳(遮罩横条 + 矩形面板 + 顶部装饰):几何与编辑模式 EditModePanel
       完全一致,由 PanelTopMask / PanelShell 共享渲染 -->
  <PanelTopMask :top="panelTop" />
  <PanelShell :height="panelHeight" :top="panelTop" class="choice-panel">
    <div class="choice-panel__inner">
      <button
        v-for="(choice, i) in displayChoices"
        :key="i"
        class="choice-panel__btn"
        type="button"
        @click="onClick(choice)"
        v-html="choice.labelHtml"
      ></button>
    </div>
  </PanelShell>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// 面板过渡几何:贴底展开/收缩的 transform-origin 与缓动
// (进入/离开类由 Vue Transition 施加;本面板为多根组件,实测不生效,
//  与重构前行为一致——保留此规则仅为结构等价)
.choice-panel {
  // 从下到上展开 / 收缩:transform-origin 锁底
  transform-origin: bottom center;
  transition: transform 0.25s ease-out, opacity 0.25s ease-out;

  &__inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    // 上下各留 20px 留空,高度由脚本按选项数动态计算
    padding: 20px 80px;
    height: 100%;
    box-sizing: border-box;
  }

  &__btn {
    // 胶囊外形:与 EditChoiceList 共享 choice-btn-core
    @include choice-btn-core;
    width: 770px;
    height: 46px;
    padding: 0 40px;
    cursor: pointer;
    // 入场:逐项淡入(按索引延迟)
    animation: choice-btn-in 0.25s ease-out backwards;
    transition: transform 0.15s ease, background 0.15s ease;

    &:hover {
      background: #999898;
      color: #ffffff;
    }

    &:active {
      transform: scale(0.98);
    }

    // 按钮逐项延迟入场
    // @for 生成 1-8 的 nth-child 延迟,选项 >8 时第 9+ 项用
    // :nth-child(n+9) 兜底:统一延迟 0.54s(=9×0.06),
    // 视觉上仍为逐项淡入,避免突然批量同时入场。
    @for $i from 1 through 8 {
      &:nth-child(#{$i}) {
        animation-delay: #{$i * 0.06}s;
      }
    }
    &:nth-child(n+9) {
      animation-delay: 0.54s;
    }
  }
}

// Vue Transition:从下到上展开 / 从上到下收缩
.choice-panel-enter-from,
.choice-panel-leave-to {
  transform: scaleY(0);
  opacity: 0;
}
</style>
