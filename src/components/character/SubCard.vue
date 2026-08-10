<script setup lang="ts">
// =============================================================================
// 子卡(可选中,选中后切换当前对话)
// -----------------------------------------------------------------------------
// 职责:
// 1. 渲染子卡视觉(rect/texture/faint/icon-box/icon/arrow/text/deco/line)
// 2. 选中态联动:rect::after 黄层 scaleX + texture/icon-box 透明 + icon 暗化 +
//    text 变色 + deco 显示 + arrow 显示
// 3. click:调用 store.selectSub(subIndex)
//
// 单文件渲染,由 CharacterCardItem 传入 subIndex/isSecond/isHover。
// =============================================================================
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '../../stores/chat'
import { MATERIALS } from '../../constants/materials'
import { findCharacter } from '../../constants/character'
import { emojiToHtml } from '../../constants/emoji'

const props = defineProps<{
  /** 子卡全局索引(扁平 conversations 下标) */
  subIndex: number
  /** 是否为第二张及以后的子卡(影响 arrow 过渡时长) */
  isSecond: boolean
  /** 子卡在主卡内的下标(0-based,用于布局/样式区分) */
  subOffsetInCard: number
  /** 子卡相对主卡顶部的 top 偏移(由父组件按 subTopInCard 计算) */
  top: number
  /** 是否 hover(由父组件管理) */
  isHover: boolean
}>()

const chatStore = useChatStore()
const { isEditMode } = storeToRefs(chatStore)

/** 该子卡是否选中(全局单选) */
const isSelected = computed(() => chatStore.activeSub === props.subIndex)

/** 该子卡对应对话是否已播放完毕(决定图标用 01 还是 02) */
const isPlayed = computed(() => chatStore.subPlayedFlags[props.subIndex])

/** 该子卡所在卡片级成员(未命名/空对话时为空数组;成员本身已排除管理员) */
const counterpartMembers = computed(() => chatStore.conversationMeta[props.subIndex]?.members ?? [])

/**
 * 子卡预览文本
 *
 * - 编辑模式:直接显示最后一条消息(应用选择覆盖,组内折叠)
 * - 播放模式:
 *   - 未播放(playedCount=0):
 *     - 未命名对话(无成员):"和TA聊聊"
 *     - 私聊(1 个成员):"和他/她聊聊"(按对方性别,查不到默认"她")
 *     - 群聊(≥2 个成员,已排除管理员):
 *         全部为女性 → "和她们聊聊";否则(全男/男女混合)→ "和他们聊聊"
 *   - 播放中 / 播放完:返回最近一条已播放消息文本
 * 超长由 CSS ellipsis 截断为 "..."。
 */
const previewText = computed(() => {
  // 编辑模式:直接显示最后一条消息(无需点进去播放)
  if (isEditMode.value) {
    return chatStore.subPreviewTexts[props.subIndex] ?? ''
  }
  const played = chatStore.playedCounts[props.subIndex] ?? 0
  if (played <= 0) {
    const members = counterpartMembers.value
    if (members.length === 0) return '和TA聊聊'
    if (members.length === 1) {
      const c = findCharacter(members[0])
      return c?.gender === 'male' ? '和他聊聊' : '和她聊聊'
    }
    const allFemale = members.every((n) => findCharacter(n)?.gender === 'female')
    return allFemale ? '和她们聊聊' : '和他们聊聊'
  }
  return chatStore.subPreviewTexts[props.subIndex] ?? ''
})

/** 预览渲染 HTML(表情 token → <img>,供 v-html) */
const previewHtml = computed(() => emojiToHtml(previewText.value))

/** 子卡根样式:动态 top 偏移(由父组件传入) */
const rootStyle = computed(() => ({
  top: props.top + 'px',
}))

/**
 * 子卡图标
 *
 * - 编辑模式:统一用 editModeToggle(deco_map_custom_mark_delete_write.png),
 *   提示"可编辑"
 * - 播放模式:未播放完用 chatBadge(01),播放完用 chatBadgePlayed(02)
 */
const badgeIcon = computed(() => {
  if (isEditMode.value) return MATERIALS.editModeToggle
  return isPlayed.value ? MATERIALS.chatBadgePlayed : MATERIALS.chatBadge
})
</script>

<template>
  <div
    class="subcard"
    :class="{
      'subcard--second': isSecond,
      'is-hover': isHover,
      'is-selected': isSelected,
    }"
    :style="rootStyle"
    @click="chatStore.selectSub(subIndex)"
  >
    <div class="subcard__rect" />
    <img class="subcard__texture" :src="MATERIALS.cardTexture" alt="" />
    <img class="subcard__faint" :src="MATERIALS.subFaint" alt="" />
    <div class="subcard__icon-box" />
    <img class="subcard__arrow" :src="MATERIALS.subArrow" alt="" />
    <img class="subcard__arrow subcard__arrow--second" :src="MATERIALS.subArrow" alt="" />
    <img class="subcard__icon" :class="{ 'subcard__icon--edit': isEditMode }" :src="badgeIcon" alt="" />
    <p class="subcard__text" v-html="previewHtml"></p>
    <img class="subcard__deco-badge" :src="MATERIALS.decoBadge" alt="" />
    <img class="subcard__deco-wing" :src="MATERIALS.decoWing" alt="" />
    <div class="subcard__line" />
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

.subcard {
  position: absolute;
  left: 70.77px;
  top: 100.86px;
  width: 0;
  height: 0;
  // hover 白层(与主卡共用 hover-overlay mixin)
  @include hover-overlay(435.53px, 68.95px, 4.12px);

  // top 由父组件通过 :style 传入(支持任意子卡数量);
  // --second 仅保留用于 arrow 过渡时长区分,不再覆盖 top
  &--second {
    // top 不再写死,由父组件传入
  }

  &__rect {
    position: absolute;
    left: 0;
    top: 0;
    width: 435.53px;
    height: 68.95px;
    border-radius: 4.12px;
    background: $color-subcard-bg;
    opacity: 1;

    // 选中黄层(scaleX 从 0 到 1)
    &::after {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      background: $color-subcard-selected;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform 0.1s ease-out;
    }
  }

  &__texture {
    position: absolute;
    left: 0;
    top: 0;
    width: 434.72px;
    height: 68.4px;
    opacity: 0.5;
    transition: opacity 0.25s ease;
  }

  &__faint {
    position: absolute;
    left: 297.93px;
    top: 0.38px;
    width: 137.6px;
    height: 68px;
    opacity: 0.02;
  }

  &__icon-box {
    position: absolute;
    left: 11.93px;
    top: 9.93px;
    width: 49.08px;
    height: 49.08px;
    border-radius: 2.74px;
    background: $color-subcard-icon-box;
    transition: opacity 0.25s ease;
  }

  &__icon {
    position: absolute;
    left: 20.72px;
    top: 24.31px;
    width: 31.5px;
    height: 25.5px;
    filter: brightness(0.882);
    transition: filter 0.25s ease;

    // 编辑模式:editModeToggle 素材为近正方形(36x38),
    // 用 contain 保持比例,避免拉伸变畸形;同时显示更明显提示"可编辑"
    &--edit {
      object-fit: contain;
      // 略放大,让编辑图标更显眼
      width: 33px;
      height: 33px;
      // 垂直居中到 icon-box(49.08 高,新 33 高,top = (49.08 - 33) / 2 + icon-box top 9.93 ≈ 17.93)
      top: 17.93px;
      // 水平相对 icon-box 居中(icon-box left 11.93 + width 49.08 / 2 = 36.47;新宽 33 / 2 = 16.5;left = 36.47 - 16.5 = 19.97)
      left: 19.97px;
      filter: none;
    }
  }

  &__arrow {
    position: absolute;
    left: 70.89px;
    top: 0.16px;
    width: 48px;
    height: 71.04px;
    opacity: 0;
    filter: brightness(0.11);
    transform: translateX(-40px);
    transition: transform 0.15s ease-out, opacity 0.15s ease-out;

    // 第二张子卡的 arrow 过渡时长更长(首张 0.15s,其余 0.25s)
    &--second {
      left: 115.45px;
      top: 0;
      transition: transform 0.25s ease-out, opacity 0.25s ease-out;
    }
  }

  &__text {
    position: absolute;
    left: 82.59px;
    top: 24.32px;
    // 可视宽度 = rect 宽 435.53 - text 起点 82.59 - 右侧留白 25.94 ≈ 327px
    // 超出部分由 ellipsis 自动截断为 "..."
    max-width: 327px;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1;
    white-space: nowrap;
    color: $color-subcard-text;
    font-size: $font-size-subcard;
    user-select: text;
    transition: color 0.25s ease;
  }

  &__line {
    position: absolute;
    left: 27.38px;
    top: 54.11px;
    width: 62.71px;
    height: 0.6px;
    background: $color-subcard-line;
    opacity: 0;
    transition: opacity 0.25s ease;
  }

  // 选中态联动:黄层展开 + texture/icon-box 透明 + icon 暗化 +
  //           text 变色 + deco 显示 + arrow 显示
  &.is-selected {
    .subcard__rect::after {
      transform: scaleX(1);
    }

    .subcard__texture,
    .subcard__icon-box {
      opacity: 0;
    }

    .subcard__icon {
      filter: brightness(0.11);
    }

    .subcard__text {
      color: $color-subcard-text-selected;
    }

    .subcard__deco-badge,
    .subcard__deco-wing,
    .subcard__line {
      opacity: 1;
    }

    .subcard__arrow {
      opacity: 0.15;
      transform: translateX(0);
    }
  }

  &__deco-badge {
    position: absolute;
    left: 26.76px;
    top: 11.43px;
    width: 29.19px;
    height: 29.19px;
    opacity: 0;
    filter: brightness(0.11);
    transition: opacity 0.25s ease;
  }

  &__deco-wing {
    position: absolute;
    left: 34.99px;
    top: 5.65px;
    width: 38.13px;
    height: 11.07px;
    transform: scaleX(-1);
    opacity: 0;
    filter: brightness(0.11);
    transition: opacity 0.25s ease;
  }
}
</style>
