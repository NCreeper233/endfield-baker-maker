<script setup lang="ts">
// =============================================================================
// 编辑模式:内联可编辑选项列表
// -----------------------------------------------------------------------------
// 触发时机:编辑模式下,mine 消息携带 choices 时,在气泡下方内联渲染。
//
// 与 ChoicePanel(播放模式)的区别:
//   - 无 #3c3b39 深色面板背景
//   - 无 choice_top_deco.png 顶部装饰
//   - 选项不可点击提交,改为 <input> 直接编辑文字
//   - 紧贴消息气泡下方显示(非固定在 chat-area 底部)
//   - 按钮水平居中于 chat-scroll,与气泡宽度无关
//
// 按钮样式与 ChoicePanel 完全一致(770×46 胶囊形白底,22px 字号),
// 保证两种模式下选项视觉风格统一。
//
// 实现说明:
//   用 <input> + :value + @input 代替 contenteditable + {{ }} 绑定。
//   - <input> 的 :value 更新不会重置光标(浏览器自动管理)
//   - @input 实时 emit,驱动父组件更新 store
//   - 不需要 ref + DOM 操作,更简单可靠
// =============================================================================
import { computed } from 'vue'
import type { PlayerChoice } from '../../types/chat'
import { CHAT_SCROLL } from '../../constants/design'
import { PANEL_BTN_H, PANEL_BTN_GAP } from '../../constants/panel'
import { MATERIALS } from '../../constants/materials'
import { emojiToHtml } from '../../constants/emoji'

const props = defineProps<{
  /** 选项列表(来自消息的 choices 数组) */
  choices: PlayerChoice[]
  /** 消息 id(父组件已持有,此处仅用于完整性) */
  messageId: number
  /** 列表左上角 y(相对 chat-scroll) */
  top: number
  /** 只读模式(导出用):不可编辑、无工具盒、无入场动画 */
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:label', choiceIndex: number, label: string): void
  (e: 'remove', choiceIndex: number): void
  (e: 'insert', choiceIndex: number): void
}>()

/** 按钮固定宽度(与 ChoicePanel 一致) */
const BTN_W = 770
/** 按钮固定高度(与 ChoicePanel 一致) */
const BTN_H = PANEL_BTN_H
/** 按钮间距(与 ChoicePanel 一致) */
const BTN_GAP = PANEL_BTN_GAP
/** 按钮左右内边距(与 ChoicePanel 一致) */
const BTN_PAD_X = 40

/** 悬停删除图标尺寸 / 间距(与 ChatArea 消息删除按钮一致) */
const DEL_W = 36
const DEL_H = 37
const DEL_GAP = 10

/** 新增选项图标(icon_btn_cancel 旋转 45° 成 "+"),紧邻删除图标右侧 */
const ADD_W = 36
const ADD_H = 36
const ADD_GAP = 10

/** 列表 left 坐标(相对 chat-scroll):按钮水平居中 */
const listLeft = (CHAT_SCROLL.w - BTN_W) / 2

/** 列表容器样式(响应式,跟随 props.top 变化) */
const listStyle = computed(() => ({
  left: listLeft + 'px',
  top: props.top + 'px',
}))

/** 只读模式下每个选项的 HTML(emoji 预渲染,与 ChoicePanel 一致) */
const readonlyChoices = computed(() =>
  props.choices.map((c) => ({ ...c, labelHtml: emojiToHtml(c.label) })),
)

/**
 * 每行容器样式:行本身绝对定位,行内按钮/工具盒再相对行偏移
 * (单元素带唯一 :key 的 v-for,避免多兄弟节点键重复导致 Vue 复用错节点)
 */
function rowStyle(i: number) {
  return {
    left: '0px',
    top: (i * (BTN_H + BTN_GAP)) + 'px',
  }
}

/** 按钮样式:固定尺寸 + 相对行容器的左上角偏移 */
function btnStyle() {
  return {
    left: '0px',
    top: '0px',
    width: BTN_W + 'px',
    height: BTN_H + 'px',
    padding: '0 ' + BTN_PAD_X + 'px',
  }
}

/**
 * 悬停图标工具盒样式:位于对应选项按钮右侧(按钮右缘 + DEL_GAP),
 * 水平排列删除图标与新增图标(删除在左,新增在右),垂直相对按钮中心对齐。
 */
function toolsStyle() {
  return {
    left: (BTN_W + DEL_GAP) + 'px',
    top: ((BTN_H - DEL_H) / 2) + 'px',
    width: (DEL_W + ADD_GAP + ADD_W) + 'px',
    height: DEL_H + 'px',
  }
}

/**
 * @input 事件:实时更新选项 label
 *
 * 直接 emit 给父组件写入 store,实现"编辑过程中选项文字实时变化"。
 * <input> 的 :value 绑定是单向的,浏览器自动管理光标位置,不会重置。
 */
function onInput(event: Event, index: number) {
  const target = event.target as HTMLInputElement
  emit('update:label', index, target.value)
}

/**
 * 点击删除图标:移除对应选项
 *
 * 直接 emit 给父组件写入 store,从 choices 数组移除该下标。
 */
function onRemove(index: number) {
  emit('remove', index)
}

/**
 * 点击新增图标:在该选项下方插入一个新选项
 *
 * 直接 emit 给父组件写入 store,在该选项下标之后插入新选项。
 */
function onInsert(index: number) {
  emit('insert', index)
}
</script>

<template>
  <div class="edit-choice-list" :class="{ 'edit-choice-list--readonly': readonly }" :style="listStyle">
    <template v-for="(choice, i) in choices" :key="choice.id ?? i">
      <!-- 每行一个容器承载按钮 + 工具盒(单元素 v-for,键唯一):
           <template v-for> 多根节点时编译器强制 :key 挂在 template 上,
           键会同时落到每个兄弟节点(按钮/工具盒键重复),Vue 按重复键
           patch 会复用错节点,导致后续插入的选项跑到错误位置。
           用 choice.id 作 key(由 createChoice 工厂统一赋值,
           在选项生命周期内稳定不变),避免删除中间项时光标位置错乱。 -->
      <div class="edit-choice-list__row" :style="rowStyle(i)">
        <!-- 编辑模式:input 可编辑;只读模式(导出):div + v-html 静态渲染 -->
        <input
          v-if="!readonly"
          type="text"
          class="edit-choice-list__btn"
          :style="btnStyle()"
          :value="choice.label"
          @input="onInput($event, i)"
        >
        <div
          v-else
          class="edit-choice-list__btn edit-choice-list__btn--readonly"
          :style="btnStyle()"
          v-html="readonlyChoices[i].labelHtml"
        ></div>
        <!-- 悬停图标工具盒:紧随对应选项按钮,悬停选项或工具盒时整组显示;
             删除(左)点击移除该选项,新增(右,icon_btn_cancel 旋转 45° 成 "+")
             点击在该选项之后插入一个新选项(只读模式不渲染) -->
        <div v-if="!readonly" class="edit-choice-list__tools" :style="toolsStyle()">
          <img
            class="edit-choice-list__del"
            :src="MATERIALS.deleteMsgBtn"
            alt="删除选项"
            @click="onRemove(i)"
          >
          <img
            class="edit-choice-list__add"
            :src="MATERIALS.deleteMsgBtn"
            alt="新增选项"
            @click="onInsert(i)"
          >
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// 悬停图标盒内图标尺寸/间距(与 script 中常量保持一致)
$del-w: 36px;
$del-h: 37px;
$add-w: 36px;
$add-h: 36px;
$add-gap: 10px;

.edit-choice-list {
  position: absolute;
  z-index: 4;
  // 列表容器本身不占尺寸,行容器被绝对定位于其上方
  width: 0;
  height: 0;

  // 每行容器:绝对定位,承载一个按钮 + 悬停工具盒
  &__row {
    position: absolute;
    width: 0;
    height: 0;

    // 行容器逐项延迟入场(行是纯 div,按行计数)
    // :nth-of-type(n+9) 兜底:选项 >8 时第 9+ 项统一延迟 0.54s。
    @for $i from 1 through 8 {
      &:nth-of-type(#{$i}) .edit-choice-list__btn {
        animation-delay: #{$i * 0.06}s;
      }
    }
    &:nth-of-type(n+9) .edit-choice-list__btn {
      animation-delay: 0.54s;
    }
  }

  &__btn {
    position: absolute;
    // 胶囊外形:与 ChoicePanel 共享 choice-btn-core
    @include choice-btn-core;
    // 选中文本时的样式
    user-select: text;
    cursor: text;
    outline: none;
    // 入场:逐项淡入(与 ChoicePanel 一致)
    animation: choice-btn-in 0.25s ease-out backwards;

    // 聚焦时:淡淡边框提示
    &:focus {
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
    }

    // 只读模式(导出):静态 div 渲染,无动画、文字居中、不选中文本
    &--readonly {
      animation: none;
      cursor: default;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  // 只读模式:行容器不应用入场动画延迟
  &--readonly .edit-choice-list__row {
    @for $i from 1 through 8 {
      &:nth-of-type(#{$i}) .edit-choice-list__btn {
        animation-delay: 0s;
      }
    }
    &:nth-of-type(n+9) .edit-choice-list__btn {
      animation-delay: 0s;
    }
  }

  // 悬停图标工具盒:默认透明,悬停对应选项按钮(前一兄弟)或工具盒自身时显示;
  // 盒内水平排列删除(左)与新增(右)两个图标。
  &__tools {
    position: absolute;
    // 层级高于选项按钮,避免被遮挡
    z-index: 1;
    pointer-events: auto;
    // 默认隐藏(整体透明,图标不单独可见)
    opacity: 0;
    transition: opacity 0.15s ease;

    // 悬停选项按钮时整组显示:半透明(与 ChatArea 消息删除按钮一致)
    .edit-choice-list__btn:hover + & {
      opacity: 0.5;
    }

    // 工具盒自身悬停保持显示(移动到图标上不消失)
    &:hover {
      opacity: 0.5;
    }
  }

  // 删除图标:盒内左端,尺寸与 ChatArea 消息删除按钮一致
  &__del {
    position: absolute;
    left: 0;
    top: 0;
    width: $del-w;
    height: $del-h;
    display: block;
    user-select: none;
    cursor: pointer;
    pointer-events: auto;

    // 图标悬停:压暗为 #999898 灰色(同 .edit-toggle:hover img)
    &:hover {
      filter: $icon-hover-gray-filter;
    }
  }

  // 新增选项图标:盒内右半(删除图标右侧 + ADD_GAP),
  // icon_btn_cancel 旋转 45° 视觉成 "+",与 ChatArea 补头像按钮(.chat-plus__icon)一致
  &__add {
    position: absolute;
    left: $del-w + $add-gap;
    top: calc(($del-h - $add-h) / 2);
    width: $add-w;
    height: $add-h;
    display: block;
    user-select: none;
    cursor: pointer;
    pointer-events: auto;
    // X 旋转 45° 成 +
    transform: rotate(45deg);

    // 图标悬停:压暗为 #999898 灰色
    &:hover {
      filter: $icon-hover-gray-filter;
    }
  }
}
</style>
