<script setup lang="ts">
// =============================================================================
// 单张主卡(可折叠,内含任意数量子卡 ≥1)
// -----------------------------------------------------------------------------
// 职责:
// 1. 渲染主卡视觉(rect/texture/faint/name/underline/corner/avatar/badge/btn)
// 2. 折叠按钮:点击切换 store.collapsed[index]
// 3. 折叠联动:箭头旋转 + 子卡 v-if 隐藏(配合 <transition name="collapse">)
// 4. hover 状态:局部 ref 管理(主卡 + 每张子卡)
//
// 子卡渲染:v-for 遍历该主卡下的所有子卡(由 store.cardSubRanges 提供全局索引),
// 用 subTopInCard(k) 计算第 k 张子卡的 top 偏移。
// =============================================================================
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '../../stores/chat'
import { MATERIALS } from '../../constants/materials'
import { isCustomAvatar } from '../../constants/character'
import { subTopInCard } from '../../constants/characterCard'
import SubCard from './SubCard.vue'

// NPC 头像判定按文件名关键字 includes,避免 Vite hash 后缀导致全等比较失败
// 匹配两张 NPC 占位图:icon_sns_npc_single_a(私聊默认) + icon_sns_npc_channel_a(群聊默认)
// 这两张是 72×131 竖幅小图,用 contain 完整显示,不参与 scale 收紧裁剪
const NPC_AVATAR_KEYS = ['icon_sns_npc_single_a', 'icon_sns_npc_channel_a']
const isNpcAvatar = (url: string) => !!url && NPC_AVATAR_KEYS.some((k) => url.includes(k))
// 自定义角色头像(data URL)同样不做二次裁切(已是方形)
const isCustomAvatarUrl = (url: string) => isCustomAvatar(url)

const props = defineProps<{
  /** 主卡索引 */
  index: number
  /** 该主卡的 top 偏移(由 CharacterCardList 计算) */
  top: number
}>()

const emit = defineEmits<{
  /** 编辑模式点击群聊卡片头像:请求打开"自定义群聊头像"弹窗(上抛到 App) */
  (e: 'open-group-avatar', cardIndex: number): void
}>()

const chatStore = useChatStore()
const { subPlayedFlags, isEditMode, cardSubRanges } = storeToRefs(chatStore)

/** 该卡片是否折叠 */
const collapsed = computed(() => chatStore.collapsed[props.index])

/** 该主卡下的全局子卡索引区间 [start, start+count) */
const range = computed(() => cardSubRanges.value[props.index] ?? { start: 0, count: 0 })

/** 该主卡下所有子卡的全局索引列表(用于 v-for) */
const subIndices = computed(() => {
  const { start, count } = range.value
  const list: number[] = []
  for (let k = 0; k < count; k++) list.push(start + k)
  return list
})

/**
 * 该主卡下所有对话是否都已完成
 *
 * 用于决定头像右上角"未读消息"提示图标是否显示:
 *   - 全部完成 → 隐藏图标
 *   - 至少一段未完成 → 显示图标并左右晃动
 */
const allPlayed = computed(() => {
  const { start, count } = range.value
  for (let k = 0; k < count; k++) {
    if (!subPlayedFlags.value[start + k]) return false
  }
  return true
})

/** 该主卡对应的干员数据(name + avatar) */
const character = computed(() => chatStore.cardCharacters[props.index])

/** 该主卡是否为群聊(卡片级成员 ≥2;决定头像能否自定义) */
const isGroupCard = computed(
  () => (chatStore.conversationMeta[range.value.start]?.members.length ?? 0) >= 2,
)

/**
 * 编辑模式下点击群聊卡片头像:请求打开"自定义群聊头像"弹窗
 *
 * 仅群聊(成员 ≥2)可自定义;私聊 / 未命名对话点击无动作(头像取角色/默认)。
 */
function onAvatarClick() {
  if (!isEditMode.value || !isGroupCard.value) return
  emit('open-group-avatar', props.index)
}

/** 局部 hover 状态:null=未 hover / 'card'=主卡 / 数字=对应子卡在主卡内的下标 */
const hover = ref<null | 'card' | number>(null)

/** 组件根元素 ref(用于 leave 时判断 relatedTarget 是否仍在卡内) */
const rootEl = ref<HTMLElement | null>(null)

function enterCard() {
  hover.value = 'card'
}

function enterSub(k: number) {
  hover.value = k
}

/**
 * 鼠标离开主卡/子卡时清除 hover
 *
 * 鼠标从主卡移到子卡时先触发主卡 pointerleave(hover=null,主卡 hover 样式丢失)
 * 再触发子卡 pointerenter(hover=k),中间一帧 hover=null 会导致视觉闪烁。
 * 因此检查 relatedTarget 是否仍在 .card-unit 内,若仍在内则不清除 hover
 * (子卡的 pointerenter 会紧接着覆盖)。
 */
function leave(event: PointerEvent) {
  const related = event.relatedTarget as Node | null
  if (related && rootEl.value?.contains(related)) return
  hover.value = null
}
</script>

<template>
  <div ref="rootEl" class="card-unit" :style="{ top: top + 'px' }">
    <!-- 主卡 -->
    <div
      class="card"
      :class="{ 'is-collapsed': collapsed, 'is-hover': hover === 'card' }"
      @pointerenter="enterCard"
      @pointerleave="leave($event)"
      @click="chatStore.toggleCollapse(index)"
    >
      <div class="card__rect" />
      <img class="card__texture" :src="MATERIALS.cardTexture" alt="" />
      <img class="card__faint" :src="MATERIALS.cardFaint" alt="" />
      <p class="card__name">{{ character.name }}</p>
      <img class="card__underline" :src="MATERIALS.underline" alt="" />
      <img class="card__corner" :src="MATERIALS.cornerDeco" alt="" />
      <div
        class="card__avatar"
        :class="{
          'is-npc': isNpcAvatar(character.avatar),
          'is-custom': isCustomAvatarUrl(character.avatar),
          'is-editable': isEditMode && isGroupCard,
        }"
        role="button"
        :tabindex="isEditMode && isGroupCard ? 0 : -1"
        :aria-label="isEditMode && isGroupCard ? '自定义群聊头像' : undefined"
        @click.stop="onAvatarClick"
        @keydown.enter.prevent="onAvatarClick"
        @keydown.space.prevent="onAvatarClick"
      >
        <!-- 裁剪夹层:overflow:hidden 限制 img scale 后的可见范围,
            外层 &__avatar 保持 overflow:visible 让 chat-indicator 能超出边框显示 -->
        <div class="card__avatar-clip">
          <img class="card__avatar-img" :src="character.avatar" alt="" />
        </div>
        <!-- 未全部完成时显示的"未读消息"提示图标(编辑模式下隐藏) -->
        <img
          v-if="!allPlayed && !isEditMode"
          class="card__chat-indicator"
          :src="MATERIALS.chatBadge"
          alt=""
        />
        <!-- 编辑模式 + 群聊:右下角"可编辑"角标(点击头像自定义群聊头像) -->
        <img
          v-if="isEditMode && isGroupCard"
          class="card__avatar-edit"
          :src="MATERIALS.editModeToggle"
          alt=""
        />
      </div>
      <button class="card__btn" type="button" @click.stop="chatStore.toggleCollapse(index)">
        <img class="card__btn-circle" :src="MATERIALS.circleBorder" alt="" />
        <img class="card__btn-arrow" :src="MATERIALS.cardArrow" alt="" />
      </button>
    </div>

    <!-- 子卡(任意数量,v-for 渲染) -->
    <transition name="collapse">
      <div v-if="!collapsed" class="card__subs">
        <SubCard
          v-for="(subIdx, k) in subIndices"
          :key="subIdx"
          :sub-index="subIdx"
          :is-second="k >= 1"
          :sub-offset-in-card="k"
          :top="subTopInCard(k)"
          :is-hover="hover === k"
          @pointerenter="enterSub(k)"
          @pointerleave="leave($event)"
        />
      </div>
    </transition>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// ---- 卡片单元:折叠时整块上下位移的载体 --------------------------------------
.card-unit {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transition: top 0.3s ease;
}

// ---- 主卡 ----------------------------------------------------------------
.card {
  position: absolute;
  left: 47.42px;
  top: 0;
  width: 0;
  height: 0;
  // hover 白层(与子卡共用 hover-overlay mixin)
  @include hover-overlay(458.28px, 92.99px, 4.39px);

  &__rect {
    position: absolute;
    left: 0;
    top: 0;
    width: 458.28px;
    height: 92.99px;
    border-radius: 4.39px;
    background: $color-card-bg;
  }

  &__texture {
    position: absolute;
    left: 0;
    top: 0;
    width: 457.6px;
    height: 92.4px;
    opacity: 0.5;
  }

  &__faint {
    position: absolute;
    left: 35.28px;
    top: 0.38px;
    width: 422.76px;
    height: 92.04px;
    opacity: 0.02;
  }

  &__name {
    position: absolute;
    left: 102.02px;
    top: 32.32px;
    line-height: 1;
    white-space: nowrap;
    color: $color-text-primary;
    font-size: $font-size-name;
    font-weight: 500;
    user-select: text;
    // 群聊名可能超长:超宽省略,避免盖住折叠按钮
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__underline {
    position: absolute;
    left: 104.02px;
    top: 62.72px;
    width: 42.75px;
    height: 4.5px;
    opacity: 0.4;
  }

  &__corner {
    position: absolute;
    left: 394.21px;
    top: 15.75px;
    width: 45px;
    height: 6px;
    opacity: 0.4;
  }

  &__avatar {
    position: absolute;
    left: 8.5px;
    top: 8.5px;
    width: 76px;
    height: 76px;
    border-radius: 6px;
    border: 1px solid $color-avatar-border;
    overflow: visible;
    z-index: 11;

    // 裁剪夹层:与外层同尺寸、同圆角,overflow:hidden 限制内部 img 的 scale 可见范围
    &-clip {
      position: absolute;
      inset: 0;
      overflow: hidden;
      border-radius: 6px;
    }

    &-img {
      position: relative;
      z-index: 11;
      width: 100%;
      height: 100%;
      object-fit: cover;
      // 头像原图为竖长方形(如 456x564),取上端正方形区域显示;
      // 再 scale 放大收紧裁剪范围,只保留脑袋部分(去掉周围留白)
      object-position: center top;
      transform: scale(1.1);
      transform-origin: center 45%;
    }

    // 默认 NPC 头像(新会话):头像框保持 76x76 不变,仅缩小内部图片,
    // 原图完整显示不裁剪(72x131 竖图 contain 等比缩放居中)
    &.is-npc &-img {
      position: absolute;
      top: 5%;
      left: 5%;
      width: 90%;
      height: 90%;
      object-fit: contain;
      object-position: center center;
      // NPC 用 contain 完整显示,不需要 scale 放大
      transform: none;
    }

    // 自定义角色头像(data URL,用户已裁好的方形图):
    // 与 NPC 同理不做二次裁切(cover + scale 会切掉脸),居中铺满
    &.is-custom &-img {
      object-fit: cover;
      object-position: center center;
      transform: none;
    }

    // 编辑模式 + 群聊:头像可点击自定义(打开裁剪弹窗)
    &.is-editable {
      cursor: pointer;
    }
  }

  // 右下角"可编辑"角标(编辑模式 + 群聊头像):小圆底承载编辑图标,悬停时淡入
  &__avatar-edit {
    position: absolute;
    right: -5px;
    bottom: -5px;
    z-index: 13;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.72);
    padding: 4px;
    box-sizing: border-box;
    object-fit: contain;
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  &:hover &__avatar-edit {
    opacity: 1;
  }

  // 未读消息提示图标:头像右上角,以图片中心为轴左右晃动
  // 动画周期 4s:左→右→左→右→归正(2s) + 等待 2s
  &__chat-indicator {
    position: absolute;
    right: -20px;
    top: -16px;
    z-index: 12;
    transform-origin: center center;
    animation: card-chat-wiggle 4s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes card-chat-wiggle {
    0% {
      transform: rotate(0deg);
    }
    5% {
      transform: rotate(-14deg);
    }
    10% {
      transform: rotate(14deg);
    }
    15% {
      transform: rotate(-14deg);
    }
    20% {
      transform: rotate(14deg);
    }
    25% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }

  &:hover &__avatar,
  &.is-hover &__avatar {
    border-color: $color-avatar-border-hover;
  }

  &__btn {
    position: absolute;
    left: 415.92px;
    top: 52.31px;
    width: 31.2px;
    height: 31.2px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;

    &-circle,
    &-arrow {
      position: absolute;
      opacity: 0.4;
    }

    &-circle {
      inset: 0;
      width: 100%;
      height: 100%;
    }

    &-arrow {
      left: 6.6px;
      top: 8.475px;
      width: 18px;
      height: 14.25px;
      transform: rotate(180deg);
      transition: transform 0.3s ease;
    }
  }

  // 折叠态:箭头回到 0deg
  &.is-collapsed .card__btn-arrow {
    transform: rotate(0deg);
  }

  // 子卡容器(仅作为 v-for 的承载,本身无尺寸/定位)
  &__subs {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
  }
}
</style>
