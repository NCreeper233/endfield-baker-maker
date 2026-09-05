<script setup lang="ts">
// =============================================================================
// 编辑模式常驻底部面板(壳)
// -----------------------------------------------------------------------------
// 编辑模式下常驻显示在聊天窗口底部的矩形框:
// 与播放模式 ChoicePanel 的矩形背景样式完全一致
// (背景 #3c3b39 + 底部圆角 + 顶部装饰图 choiceTopDeco),
// 但高度固定为 80px。
//
// 面板靠右端内置 6 个直径 45px 的圆形按钮(垂直居中,背景 #f0eeee),
// 每个按钮承载一个图标素材,悬停时显示灰色遮罩。
// 按钮为后续编辑操作入口预留,
// 因此面板自身 pointer-events: none,按钮单独 pointer-events: auto。
//
// 布局复刻 ChoicePanel 的贴底公式:
//   left  = detail.x + 2,width = detail.w - 4(左右各缩 2px)
//   top   = detail 底边 - PANEL_H - 3(整体上移 3px,与播放模式一致)
// 顶部装饰图:距面板上端 5px,水平居中,悬浮在面板上边缘上方(与 ChoicePanel 相同)。
//
// 拆分层:
//   - 壳:面板壳(PanelTopMask 遮罩横条 + PanelShell 矩形背景/顶部装饰)+
//         6 按钮列 + 弹窗容器/定位 + popKind 协调 +
//         openCharacterPicker/closeCharacterPicker expose
//   - EditComposer:输入框 + 上传图片 + 三种发送 + 表情插入(expose 供壳调用)
//   - CharacterPicker:角色头像网格(选中高亮 / 管理员禁用)
//   - 表情弹窗网格与输入强耦合,但网格本身是纯展示,渲染留在壳(与角色弹窗共用
//     同一 .edit-pop 容器与过渡),点击时经 EditComposer expose 插入表情。
// =============================================================================
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { PANEL, panelTop as calcPanelTop } from '../../constants/panel'
import { MATERIALS } from '../../constants/materials'
import type { CharacterSelection } from '../../constants/character'
import { EMOJIS } from '../../constants/emoji'
import { roleNameKey, useChatStore } from '../../stores/chat'
import EditComposer from './EditComposer.vue'
import CharacterPicker from './CharacterPicker.vue'
import PanelTopMask from './PanelTopMask.vue'
import PanelShell from './PanelShell.vue'

/** 面板高度(px):播放模式 ChoicePanel 为 230,编辑模式常驻面板为 80 */
const PANEL_H = 80

/** 面板顶 = detail 底边 - 面板高 - 3px(共享公式,与播放模式一致) */
const panelTop = calcPanelTop(PANEL_H)

/** 按钮图标(从左到右,共 6 个) */
const BTN_ICONS = [
  MATERIALS.editBtnTask,
  MATERIALS.editBtnEvents,
  MATERIALS.editBtnWarn,
  MATERIALS.editBtnPotential,
  MATERIALS.editBtnEmoticon,
  MATERIALS.editBtnChat,
]

/** 触发弹出面板的按钮:最左头像按钮 + 第 5 个按钮(表情,index 4) */
const POP_TRIGGER_BTN_INDEX = 4

/** 各按钮的无障碍标签 */
const BTN_LABELS = ['创建任务面板', '以选项发送', '以居中文本发送', '上传图片', '表情', '发送消息']

/** 输入区组件实例(经 expose 触发发送 / 文件选择 / 表情插入) */
const composerRef = ref<InstanceType<typeof EditComposer> | null>(null)

/** 按钮点击分发:任务面板(0)→ 分段矩形;表情(4)→ 弹出面板;居中(2)→ 居中文本;选项(1)→ 选项发送;图片(3)→ 文件选择;发送(5)→ 普通发送 */
function onBtnClick(i: number) {
  if (i === 0) {
    composerRef.value?.sendPanel()
  } else if (i === POP_TRIGGER_BTN_INDEX) {
    togglePop('emoticon')
  } else if (i === 1) {
    composerRef.value?.sendOption()
  } else if (i === 2) {
    composerRef.value?.sendCentered()
  } else if (i === 3) {
    composerRef.value?.openFilePicker()
  } else if (i === 5) {
    composerRef.value?.sendNormal()
  }
}

/** 角色弹窗高度(px) */
const POP_H_CHARACTER = 430
/**
 * 表情弹窗高度(px):38 个表情每行 16 个 → 3 行,恰好装下
 * (24 上下边距 + 3×60 格 + 2×16 行距,不出现滚动条)
 */
const POP_H_EMOTICON = 24 * 2 + 3 * 60 + 2 * 16

/** 弹出面板类型 */
type PopKind = 'character' | 'emoticon'

/** 当前弹出的面板类型(null = 收起) */
const popKind = ref<PopKind | null>(null)

const chatStore = useChatStore()
const { myIdentity } = storeToRefs(chatStore)

/**
 * 消息头像更换目标:被点击头像的消息 id(null = 未选中)
 *
 * 由 ChatArea 在点击消息头像时传入,面板的角色弹窗此时为"更换该消息身份"服务;
 * 为 null 时仍走原逻辑(点击面板头像按钮,更新"我"的发送身份)。
 * 本卡"我方身份"(mine 侧)头像不可更换,ChatArea 不会为其设置目标。
 */
const props = defineProps<{
  avatarTarget: number | null
}>()

const emit = defineEmits<{
  /** 更换目标消息身份完成后通知父组件(父组件清空目标) */
  (e: 'avatar-target-used'): void
  /** 点击角色面板末尾 ＋按钮:请求打开"添加自定义角色"弹窗(上抛到 App) */
  (e: 'open-custom-character'): void
}>()

/**
 * 当前角色弹窗内应高亮的头像:
 * - 有 avatarTarget:该消息当前说话人身份的头像(与聊天区渲染完全一致)
 * - 无 avatarTarget:`我`的发送身份头像
 *
 * 解析逻辑与 ChatArea 共用 chatStore.resolveMessageAvatar,保证一致。
 * mine 侧默认头像 = 当前父卡"我方身份"头像。
 */
const selectedAvatar = computed(() => {
  if (props.avatarTarget == null || chatStore.activeSub === null) {
    return myIdentity.value.avatar
  }
  const conv = chatStore.conversations[chatStore.activeSub]
  const msg = conv?.messages.find((m) => m.id === props.avatarTarget)
  if (!msg) return myIdentity.value.avatar
  return chatStore.resolveMessageAvatar(
    msg,
    conv?.name ?? '',
    chatStore.currentOtherAvatarUrl,
    chatStore.activeCardIdentityAvatar,
  )
})

/**
 * 更换他人消息身份时,弹窗内禁用的身份键 = 本卡"我方身份"
 *
 * "我"是聊天区不可替换的固定身份,头像菜单里不提供再选回"我"的入口
 * (角色网格中本卡身份头像置灰)。底部发送身份选择(avatarTarget 为空)
 * 不受限制,可自由设回任何身份。
 */
const disabledIdentityKey = computed(() => {
  if (props.avatarTarget == null) return undefined
  const identity = chatStore.activeCardIdentity
  return roleNameKey(identity.name, identity.customId)
})

/** 弹出面板高度:表情弹窗按内容,角色弹窗固定 430 */
const popHeight = computed(() =>
  popKind.value === 'emoticon' ? POP_H_EMOTICON : POP_H_CHARACTER,
)

/** 弹出面板样式:相对面板定位,紧贴面板顶边向上延伸,宽度与面板一致 */
const popStyle = computed(() => ({
  left: '0px',
  top: `-${popHeight.value}px`,
  width: `${PANEL.width}px`,
  height: `${popHeight.value}px`,
}))

/**
 * 点击触发按钮:切换对应类型面板的展开/收起
 *
 * 注意:面板按钮(头像/表情)触发的打开或关闭,一律放弃消息头像目标
 *   (avatarTarget 改成 null)——消息头像的打开走 openCharacterPicker,
 *   不经过这里。这样避免"先点消息头像、再经面板按钮重开三角"时
 *   角色选择误改旧消息(表情按钮切换路径)。
 *
 * @param kind 面板类型(character = 角色头像选择,emoticon = 表情)
 */
function togglePop(kind: PopKind) {
  if (popKind.value === kind) {
    popKind.value = null
  } else {
    popKind.value = kind
  }
  if (props.avatarTarget != null) emit('avatar-target-used')
}

/**
 * 点击面板外部关闭弹出面板(角色 / 表情)
 *
 * 规则:弹出面板展开时,点击**除弹出面板与两个触发按钮**(头像按钮 /
 * 表情按钮)以外的任意位置即收起。触发按钮的开关仍走各自的 togglePop,
 * 此处跳过它们避免与"切换到另一面板"冲突(如角色面板开着时点表情按钮
 * 应切换到表情面板而非直接关闭)。
 *
 * 用 pointerdown(先于 click 触发):点到外面任意元素(含其他按钮)时,
 * 面板先收起,按钮自身的 click 动作照常执行。
 */
function onDocPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (!(target instanceof Element)) return
  if (
    target.closest('.edit-pop') ||
    target.closest('.edit-panel__avatar') ||
    target.closest('.is-pop-trigger')
  ) {
    return
  }
  if (popKind.value != null) {
    popKind.value = null
    // 与 togglePop 关闭时一致:放弃消息头像目标,避免目标残留
    if (props.avatarTarget != null) emit('avatar-target-used')
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))

/**
 * 选择角色:
 * - avatarTarget 存在:把该消息身份换成选中角色,选完自动关闭弹窗
 * - avatarTarget 为空:更新"我"的发送身份(弹窗保持展开,可连续查看选择)
 *
 * @param c 选中的角色(自定义角色带 customId,与内置重名时靠它区分)
 */
function selectCharacter(c: CharacterSelection) {
  if (props.avatarTarget != null) {
    chatStore.changeMessageIdentity(props.avatarTarget, c.name, c.avatar, c.customId)
    emit('avatar-target-used')
    popKind.value = null
  } else {
    chatStore.setMyIdentity(c.name, c.avatar, c.customId)
  }
}

/** 删除自定义角色(格内 ×);已引用该角色的消息仍保留各自头像 */
function removeCustomCharacter(id: string) {
  chatStore.removeCustomCharacter(id)
}

/** 点击 ＋ 新增自定义角色:上抛给 App 打开弹窗 */
function openCustomCharacterDialog() {
  emit('open-custom-character')
}

/**
 * 暴露给 ChatArea:点击消息头像时调用,弹出角色头像选择面板
 *
 * 用"强制打开"(而非 toggle):消息头像点击不负责关闭,关闭仍走
 * 面板自身头像按钮 toggle 或切换到表情面板。
 */
defineExpose({
  openCharacterPicker() {
    popKind.value = 'character'
  },
  closeCharacterPicker() {
    popKind.value = null
  },
})
</script>

<template>
  <!-- 面板壳(遮罩横条 + 矩形面板 + 顶部装饰):几何与播放模式 ChoicePanel
       完全一致,由 PanelTopMask / PanelShell 共享渲染 -->
  <PanelTopMask :top="panelTop" />
  <PanelShell :height="PANEL_H" :top="panelTop" class="edit-panel">
    <!-- 我方发送身份头像按钮:点击弹出角色选择面板(无全局管理员性别切换,
         性别由身份本身承载——管理员(男)/(女)就是网格里两个选项) -->
    <button
      class="edit-panel__avatar"
      type="button"
      aria-label="我的头像"
      @click="togglePop('character')"
    >
      <img class="edit-panel__avatar-img" :src="myIdentity.avatar" alt="" />
    </button>
    <EditComposer ref="composerRef" />
    <div class="edit-panel__btns">
      <button
        v-for="(icon, i) in BTN_ICONS"
        v-tooltip="BTN_LABELS[i]"
        :key="i"
        class="edit-panel__btn"
        type="button"
        :class="{ 'is-pop-trigger': i === POP_TRIGGER_BTN_INDEX }"
        :aria-label="BTN_LABELS[i]"
        @click="onBtnClick(i)"
      >
        <img
          :class="[
            'edit-panel__btn__icon',
            { 'edit-panel__btn__icon--full': i === 0, 'edit-panel__btn__icon--small': i === 1 },
          ]"
          :src="icon"
          alt=""
        />
      </button>
    </div>

    <!-- 弹出面板:点击头像按钮 / 表情按钮时,紧贴面板顶边从下到上展开
         (角色弹窗高 430px;表情弹窗高 260px 恰好装下 3 行网格,均与面板同宽) -->
    <Transition name="edit-pop">
      <div v-if="popKind" class="edit-pop" :style="popStyle">
        <!-- 背景装饰:左上角 + 右下角两张,原始尺寸原样贴角 -->
        <img class="edit-pop__bg edit-pop__bg--tl" :src="MATERIALS.editPopDecoTl" alt="" />
        <img class="edit-pop__bg edit-pop__bg--br" :src="MATERIALS.editPopDecoBr" alt="" />
        <!-- 角色头像选择(子组件):自定义角色最前 → 全部干员每行 12 个 → 末尾 ＋;
             更换他人消息身份(avatarTarget 存在)时,本卡"我方身份"置灰禁用 -->
        <CharacterPicker
          v-if="popKind === 'character'"
          :avatar-target="avatarTarget"
          :selected-avatar="selectedAvatar"
          :disabled-identity-key="disabledIdentityKey"
          @select="selectCharacter"
          @remove="removeCustomCharacter"
          @add-custom="openCustomCharacterDialog"
        />
        <!-- 表情选择:37 个表情每行 16 个,可滚动;点击在输入框光标处插入 -->
        <div v-if="popKind === 'emoticon'" class="edit-pop__emoji-grid">
          <button
            v-for="e in EMOJIS"
            :key="e.token"
            class="edit-pop__emoji-cell"
            type="button"
            @click="composerRef?.insertEmoji(e)"
          >
            <img class="edit-pop__emoji-img" :src="e.src" alt="" />
          </button>
        </div>
      </div>
    </Transition>
  </PanelShell>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

// 面板布局(矩形背景/圆角/层叠/高度由 PanelShell 提供;遮罩横条由 PanelTopMask 提供)
.edit-panel {
  // 左右各留 24px,内部间距 16px,所有子项垂直居中
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  box-sizing: border-box;
  // 面板本身无交互:不拦截鼠标事件,滚动区滚动条仍可操作
  pointer-events: none;

  // 头像按钮:45px 圆形,图片材质(我方头像);
  // 裁切方式与聊天区头像一致(圆形 + 上端对齐取正)
  &__avatar {
    flex-shrink: 0;
    width: 45px;
    height: 45px;
    border: none;
    border-radius: 50%;
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    // 面板不拦截事件,但按钮自身需可交互
    pointer-events: auto;

    &-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      // 头像原图为竖长方形,取上端正方形区域显示(与 ChatAvatar 一致)
      object-position: center top;
      display: block;
    }
  }

  // 按钮组:靠右端;flex 布局让按钮在面板高度变化时仍自动居中
  &__btns {
    display: flex;
    align-items: center;
    gap: 16px;
    pointer-events: none;
  }

  &__btn {
    width: 45px;
    height: 45px;
    border: none;
    border-radius: 50%;
    background: $color-btn-bg;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    position: relative;
    // 面板不拦截事件,但按钮自身需可交互
    pointer-events: auto;

    // 悬停灰色遮罩:圆角随按钮,淡入淡出
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: $color-hover-overlay-gray;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    &:hover::after {
      opacity: 1;
    }

    // 图标:等比铺满按钮(留 8px 边距),不裁切不变形;
    // 原图为白色单色图标,与二级卡片选中态同思路用 brightness 压暗,
    // 255 × 0.267 ≈ 68,得到目标色 #444343
    &__icon {
      position: absolute;
      inset: 8px;
      width: calc(100% - 16px);
      height: calc(100% - 16px);
      object-fit: contain;
      filter: brightness(0.267);
      pointer-events: none;
      user-select: none;

      // 第一个按钮(icon_decorate_task_1)保持原始大小(留 4px 边距)
      &--full {
        inset: 4px;
        width: calc(100% - 8px);
        height: calc(100% - 8px);
      }

      // 第二个按钮(icon_events_overview)再缩小一点(留 10px 边距)
      &--small {
        inset: 10px;
        width: calc(100% - 20px);
        height: calc(100% - 20px);
      }
    }
  }

  // 弹出面板:紧贴面板顶边向上延伸,与面板同宽(圆角矩形,底部直角贴合面板)
  .edit-pop {
    position: absolute;
    background: #dedcdc;
    border-radius: 16px 16px 0 0;
    z-index: 11;
    // 内容未定,暂不拦截事件
    pointer-events: none;
    overflow: hidden;

    // 背景装饰图:原始尺寸原样贴角,不拉伸不铺满
    &__bg {
      position: absolute;
      pointer-events: none;
      user-select: none;

      &--tl {
        left: 0;
        top: 0;
      }

      &--br {
        right: 0;
        bottom: 0;
      }
    }

    // 表情选择网格:每行 16 个 60px 格,超出面板高度时可滚动
    &__emoji-grid {
      position: absolute;
      inset: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 24px;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: repeat(16, 60px);
      justify-content: center;
      column-gap: 12px;
      row-gap: 16px;
      align-content: start;
      scrollbar-width: thin;
      scrollbar-color: $color-scrollbar-chat transparent;
      // 面板不拦截事件,网格需可交互
      pointer-events: auto;
    }

    // 单个表情:60px 方格,原图等比铺满;点击在输入框光标处插入
    &__emoji-cell {
      width: 60px;
      height: 60px;
      border: none;
      border-radius: 8px;
      padding: 0;
      cursor: pointer;
      background: transparent;
      position: relative;

      // 悬停白色半透明遮罩(同角色头像格)
      &::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 8px;
        background: $color-hover-overlay;
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      &:hover::after {
        opacity: 1;
      }
    }

    &__emoji-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
  }

  // 从下到上展开 / 从上到下收起:transform-origin 锁底(与 ChoicePanel 同思路)
  .edit-pop-enter-active,
  .edit-pop-leave-active {
    transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    transform-origin: bottom center;
  }

  .edit-pop-enter-from,
  .edit-pop-leave-to {
    transform: scaleY(0);
    opacity: 0;
  }
}
</style>
