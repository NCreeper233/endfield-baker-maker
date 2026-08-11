<script setup lang="ts">
// =============================================================================
// 角色头像选择弹窗(CharacterPicker)
// -----------------------------------------------------------------------------
// 职责:渲染角色头像网格(每行 12 个,可滚动),点击后上报选择结果。
// 网格顺序:[内置干员…, 自定义角色…, ＋按钮]:
//   - 自定义角色靠 customId 区分(可与内置重名),格内带 × 删除按钮
//   - ＋按钮点击上报 add-custom,由上层打开"添加自定义角色"弹窗
// 从 EditModePanel 壳拆出,聚焦"选择目标 + 网格渲染":
//   - avatarTarget 非空:该弹窗用于更换目标消息身份,经 disabledIdentityKey
//     禁用指定角色(如本卡"我方身份"——"我"不可被别人替换)
//   - avatarTarget 为空:更新"我"的发送身份(底部选择),不禁止任何角色
// 选中高亮由壳计算传入(selectedAvatar,与聊天区解析链一致)。
// =============================================================================
import { storeToRefs } from 'pinia'
import { CHARACTERS } from '../../constants/character'
import type { Character, CharacterSelection, CustomCharacter } from '../../constants/character'
import { MATERIALS } from '../../constants/materials'
import { roleNameKey, useChatStore } from '../../stores/chat'

const chatStore = useChatStore()
const { customCharacters } = storeToRefs(chatStore)

const props = defineProps<{
  /** 消息头像更换目标:被点击头像的消息 id(null = 更新"我"的发送身份) */
  avatarTarget: number | null
  /** 当前弹窗内应高亮的头像 URL(与聊天区渲染解析链一致) */
  selectedAvatar: string
  /** 该弹窗内禁止选择的身份键(仅 avatarTarget 非空时生效;本卡"我方身份"传入) */
  disabledIdentityKey?: string
}>()

const emit = defineEmits<{
  /** 点击某个角色头像(自定义或内置,由壳决定更换消息身份 / 更新发送身份) */
  select: [character: CharacterSelection]
  /** 点击自定义角色格内的 × 删除按钮 */
  remove: [id: string]
  /** 点击末尾 ＋按钮(上层打开"添加自定义角色"弹窗) */
  addCustom: []
}>()

/**
 * 单格禁用判定:
 * - 更换他人消息身份(avatarTarget 非空)且指定了 disabledIdentityKey:
 *   角色身份键与之一致则禁用(如本卡"我方身份"不可被替换)
 * - 其余(底部发送身份选择 / 未指定禁用键):不禁止任何角色
 */
function isCellDisabled(name: string, customId?: string): boolean {
  if (props.avatarTarget === null || !props.disabledIdentityKey) return false
  return roleNameKey(name, customId) === props.disabledIdentityKey
}

/** 自定义角色 → 选择载荷 */
function toSelection(c: CustomCharacter): CharacterSelection {
  return { name: c.name, avatar: c.avatar, gender: c.gender, customId: c.id }
}

/** 内置角色 → 选择载荷(不带 customId,靠名字指向静态表) */
function toSelectionBuiltIn(c: Character): CharacterSelection {
  return { name: c.name, avatar: c.avatar, gender: c.gender }
}
</script>

<template>
  <!-- 角色头像选择:全部干员每行 12 个 → 自定义角色 → 末尾 ＋,可滚动;
       更换他人消息身份时按 disabledIdentityKey 禁用指定角色(如本卡"我方身份"),
       底部发送身份选择不禁止任何角色 -->
  <div class="character-picker__grid">
    <!-- 内置干员 -->
    <button
      v-for="c in CHARACTERS"
      :key="c.name"
      class="character-picker__cell"
      :class="{
        'is-selected': c.avatar === selectedAvatar,
        'is-disabled': isCellDisabled(c.name),
      }"
      :disabled="isCellDisabled(c.name)"
      type="button"
      @click="emit('select', toSelectionBuiltIn(c))"
    >
      <img class="character-picker__cell-img" :src="c.avatar" alt="" />
    </button>

    <!-- 自定义角色(靠 id 区分,可与内置重名;格内 × 删除) -->
    <div
      v-for="c in customCharacters"
      :key="c.id"
      class="character-picker__cell character-picker__cell--custom"
      :class="{ 'is-selected': c.avatar === selectedAvatar, 'is-disabled': isCellDisabled(c.name, c.id) }"
    >
      <button
        class="character-picker__cell-select"
        type="button"
        :disabled="isCellDisabled(c.name, c.id)"
        @click="emit('select', toSelection(c))"
      >
        <img class="character-picker__cell-img" :src="c.avatar" alt="" />
      </button>
      <button
        class="character-picker__cell-del"
        type="button"
        aria-label="删除自定义角色"
        @click="emit('remove', c.id)"
      >
        ×
      </button>
    </div>

    <!-- ＋ 新增自定义角色 -->
    <button
      class="character-picker__cell character-picker__cell--add"
      type="button"
      aria-label="添加自定义角色"
      @click="emit('addCustom')"
    >
      <img class="character-picker__cell-img" :src="MATERIALS.iconPlusmark" alt="" />
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

// 角色头像网格:每行 12 个,超出面板高度时可滚动
.character-picker__grid {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(12, 88px);
  justify-content: center;
  // 12 × 88 + 11 × 19 = 1265px,不超出面板可用宽(1320 - 24×2 = 1272)
  column-gap: 19px;
  row-gap: 16px;
  align-content: start;
  scrollbar-width: thin;
  scrollbar-color: $color-scrollbar-chat transparent;
  // 面板不拦截事件,网格需可交互
  pointer-events: auto;
}

// 单个角色头像:圆形裁切(与聊天区头像一致),点击选择
.character-picker__cell {
  width: 88px;
  height: 88px;
  border: none;
  border-radius: 50%;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  position: relative;

  // 选中角色:黄色圆环高亮(同子卡选中色)
  &.is-selected {
    box-shadow: 0 0 0 3px $color-subcard-selected;
  }

  // 禁用格(如本卡"我方身份"):更换他人消息身份时按 disabledIdentityKey 置灰
  &.is-disabled {
    opacity: 0.35;
    filter: grayscale(1);
    cursor: not-allowed;

    // 抑制悬停白色遮罩
    &::after {
      opacity: 0;
    }
  }

  // 悬停白色半透明遮罩(同主卡/子卡 hover 白层)
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: $color-hover-overlay;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  &:hover::after {
    opacity: 1;
  }

  &-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    // 头像原图为竖长方形,取上端正方形区域显示(与 ChatAvatar 一致)
    object-position: center top;
    display: block;
  }
}

// 自定义角色格:外层 div 不裁圆(× 删除钮要露在角外),内部选择钮承担圆形裁切;
// 悬停白色遮罩由内部选择钮自己渲染,父层 ::after 禁用避免盖住 × 钮
.character-picker__cell--custom {
  overflow: visible;

  &::after {
    display: none;
  }

  .character-picker__cell-select {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 50%;
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    background: transparent;
    position: relative;
    display: block;

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: $color-hover-overlay;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    &:hover::after {
      opacity: 1;
    }
  }

  .character-picker__cell-del {
    position: absolute;
    top: -4px;
    right: -4px;
    z-index: 1;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.72);
    color: #fff;
    font-family: $font-harmony;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background: rgba(0, 0, 0, 0.9);
    }
  }
}

// ＋ 新增角色格:浅色圆底 + 加号素材(素材缩小显示:加大内边距,保留 contain 居中)
.character-picker__cell--add {
  background: #f0eeee;

  .character-picker__cell-img {
    object-fit: contain;
    object-position: center;
    padding: 30px;
    box-sizing: border-box;
  }
}
</style>
