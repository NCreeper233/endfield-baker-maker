<script setup lang="ts">
// =============================================================================
// 应用根组件
// -----------------------------------------------------------------------------
// 组装:背景层 + 等比缩放画布(顶部标题 + 干员卡片列表 + 聊天区 + 编辑模式切换按钮)。
// 编辑模式切换按钮放在 DesignCanvas 内、所有业务组件之上,定位到页面右上角。
// 删除确认弹窗为独立组件(DeleteConfirmDialog),打开状态与删除动作在此持有。
// 调试模式:URL 包含 #debug 时,useDebugMode 会在左下角渲染气泡尺寸信息。
// =============================================================================
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppBackground from './components/layout/AppBackground.vue'
import DesignCanvas from './components/layout/DesignCanvas.vue'
import HeaderTop from './components/header/HeaderTop.vue'
import CharacterCardList from './components/character/CharacterCardList.vue'
import ChatArea from './components/chat/ChatArea.vue'
import DeleteConfirmDialog from './components/layout/DeleteConfirmDialog.vue'
import DataManagerDialog from './components/layout/DataManagerDialog.vue'
import ChatExportDialog from './components/layout/ChatExportDialog.vue'
import AboutDialog from './components/layout/AboutDialog.vue'
import { useChatStore } from './stores/chat'
import { storeToRefs } from 'pinia'
import { MATERIALS } from './constants/materials'
import { useDebugMode } from './composables/useDebugMode'
import { useCustomBackground } from './composables/useCustomBackground'

const chatStore = useChatStore()
const { isEditMode } = storeToRefs(chatStore)

// 调试浮层(非调试模式下为空操作)
useDebugMode()

// 自定义页面背景(带 localStorage 持久化:刷新保留、不随 .baker 导出、
// 不受清空对话影响;上传成功赋值后自动落库)
const { customBg } = useCustomBackground()

/** 删除确认弹窗是否展开(删除按钮 toggle) */
const confirmOpen = ref(false)

/** 数据管理弹窗是否展开(清除数据按钮 toggle) */
const dataManagerOpen = ref(false)

/** 导出聊天截图弹窗是否展开(分享按钮 toggle) */
const shareOpen = ref(false)

/** 关于菜单弹窗是否展开(编辑模式警告铃铛按钮 toggle) */
const aboutOpen = ref(false)

/** 背景上传按钮对应的隐藏 file input */
const bgInput = ref<HTMLInputElement | null>(null)

/** 上传图片作为自定义页面背景(读为 data URL 交给 AppBackground 渲染) */
function onBgUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    customBg.value = typeof reader.result === 'string' ? reader.result : null
  }
  // FileReader 可能因文件损坏 / 权限问题失败,失败时打印警告,input 一并清空可重试。
  reader.onerror = () => {
    console.warn('[App] 背景图片读取失败,可能是损坏或不受支持的格式')
  }
  reader.readAsDataURL(file)
  ;(event.target as HTMLInputElement).value = ''
}

/** 确认删除:删除当前选中的子对话(唯一子对话时连带删除父级卡片)并关闭弹窗 */
function onConfirmDelete() {
  chatStore.deleteActiveConversation()
  confirmOpen.value = false
}

/**
 * 播放模式下是否隐藏"进入编辑模式"按钮(按 E 切换)
 *
 * 纯运行时 UI 状态:不持久化、不入 IndexedDB,刷新即恢复默认(显示);
 * 仅播放模式生效(编辑模式必须能切回,不参与隐藏)。
 */
const hideEditToggle = ref(false)

function onToggleKeydown(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'e') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // 输入框内打字时不触发(编辑模式才有输入,此处为兜底)
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (isEditMode.value) return
  hideEditToggle.value = !hideEditToggle.value
}

onMounted(() => window.addEventListener('keydown', onToggleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onToggleKeydown))
</script>

<template>
  <AppBackground :custom-url="customBg" />
  <DesignCanvas>
    <HeaderTop />
    <CharacterCardList />
    <ChatArea />
  </DesignCanvas>
  <!-- 编辑模式切换按钮:视口右上角(fixed 定位,不受画布 overflow:hidden 限制);
       播放模式下按 E 可隐藏/恢复(纯运行时状态,刷新重置为显示) -->
  <button
    v-show="!hideEditToggle"
    class="edit-toggle"
    type="button"
    @click="chatStore.toggleEditMode()"
  >
    <img :src="isEditMode ? MATERIALS.editModeActive : MATERIALS.editModeToggle" alt="编辑" />
  </button>
  <!-- 编辑模式专属按钮:位于编辑切换按钮下方,同样式,仅编辑模式显示;
       点击新建会话(左侧新增"未命名会话"主卡并自动选中) -->
  <button
    v-if="isEditMode"
    class="edit-toggle edit-toggle--chat09"
    type="button"
    @click="chatStore.createConversation()"
  >
    <img :src="MATERIALS.editBtnChat09" alt="聊天" />
  </button>
  <!-- 背景自定义按钮:位于 chat09 按钮右侧(建会话与删除界面之间),仅编辑模式显示;
       点击弹出本地图片选择,上传图片作为自定义页面背景(原游戏背景被覆盖) -->
  <button
    v-if="isEditMode"
    class="edit-toggle edit-toggle--bg"
    type="button"
    @click="bgInput?.click()"
  >
    <img :src="MATERIALS.editBtnUpgrade" alt="自定义背景" />
  </button>
  <!-- 隐藏的文件选择框(由上面按钮触发) -->
  <input
    ref="bgInput"
    type="file"
    accept="image/*"
    class="bg-file-input"
    @change="onBgUpload"
  />
  <!-- 删除对话按钮:与 chat09 按钮同列(正下方),仅编辑模式显示;点击弹出确认弹窗 -->
  <button
    v-if="isEditMode"
    class="edit-toggle edit-toggle--delete"
    type="button"
    @click="confirmOpen = !confirmOpen"
  >
    <img :src="MATERIALS.editBtnDeleteIndeed" alt="删除对话" />
  </button>

  <!-- 编辑模式右侧操作按钮:横向等距排列,仅编辑模式显示。
       导出 → 打开数据管理弹窗(统计/导出/导入/清空/重置;原独立"清除数据"按钮
       已并入此按钮) -->
  <button v-if="isEditMode" class="edit-toggle edit-toggle--export" type="button" @click="dataManagerOpen = true">
    <img :src="MATERIALS.editBtnExport" alt="导出" />
  </button>
  <button v-if="isEditMode" class="edit-toggle edit-toggle--share" type="button" @click="shareOpen = true">
    <img :src="MATERIALS.editBtnShare" alt="分享" />
  </button>
  <!-- 关于菜单按钮:位于按钮列最左侧(share 左侧),警告铃铛图标旋转 180°;
       点击打开关于/更新日志/链接弹窗 -->
  <button
    v-if="isEditMode"
    class="edit-toggle edit-toggle--about"
    type="button"
    @click="aboutOpen = true"
  >
    <img class="edit-toggle--about__icon" :src="MATERIALS.editBtnWarn" alt="关于" />
  </button>

  <!-- 删除对话确认弹窗:fixed 视口定位,1920 原始尺寸不缩放 -->
  <DeleteConfirmDialog :open="confirmOpen" @confirm="onConfirmDelete" @cancel="confirmOpen = false" />
  <!-- 数据管理弹窗:清除数据按钮触发 -->
  <DataManagerDialog :open="dataManagerOpen" @close="dataManagerOpen = false" />
  <!-- 导出聊天截图弹窗:分享按钮触发(仅编辑模式工具栏显示) -->
  <ChatExportDialog
    :open="shareOpen"
    :conversation-title="chatStore.counterpartName"
    :custom-bg-url="customBg"
    @close="shareOpen = false"
  />
  <!-- 关于菜单弹窗:原标题 / 更新日志 / 链接 -->
  <AboutDialog :open="aboutOpen" @close="aboutOpen = false" />
</template>

<style scoped lang="scss">
@use './styles/variables' as *;

.edit-toggle {
  position: fixed;
  right: 60px;
  // 整列按钮改到页面顶端,横向等距排布(不再纵向叠在右侧)
  top: 44px;
  z-index: 100;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  width: auto;
  height: auto;

  // 编辑模式专属按钮:位于编辑切换按钮左侧(横向排布,每个按钮间距 75px)
  &--chat09 {
    right: 135px;
  }

  // 背景自定义按钮:位于 chat09 与删除对话之间(同排横向等距)
  &--bg {
    right: 210px;
  }

  // 删除对话按钮:位于背景按钮左侧(同排横向等距)
  &--delete {
    right: 285px;
  }

  // 右侧操作按钮(导出/分享):横向等距排列(每个按钮间距 75px;原清除数据按钮已并入导出按钮)
  &--export {
    right: 360px;
  }

  &--share {
    right: 435px;
  }

  // 关于菜单按钮:位于按钮列最左侧(share 左侧,同排横向等距)
  &--about {
    right: 510px;
  }

  // 警告铃铛图标旋转 180°(按钮点开是"关于/菜单"而非警告)
  &--about__icon {
    transform: rotate(180deg);
  }

  img {
    display: block;
    width: 25px;
    height: auto;
    opacity: 0.5;
  }

  // 唯一特效:hover 时图标染为 #999898 灰色
  &:hover img {
    filter: $icon-hover-gray-filter;
  }
}

// 背景上传用的隐藏 file input(由工具栏"自定义背景"按钮触发弹出)
.bg-file-input {
  position: fixed;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

// ---- 移动端适配 -----------------------------------------------------------
// 桌面端 7 个工具栏按钮横向铺开占 ~475px(间距 75px、图标 25px),窄屏会溢出左侧。
// 移动端整体收紧:图标缩到 20px、间距收到 38px、起点贴近右边缘 12px,
// 让全部按钮在 ≥320px 视口下完整可见。仅调整 right / 尺寸,不改结构与桌面端布局。
@media (max-width: 600px) {
  .edit-toggle {
    right: 12px;
    top: 12px;

    img {
      width: 20px;
    }

    &--chat09 {
      right: 50px;
    }

    &--bg {
      right: 88px;
    }

    &--delete {
      right: 126px;
    }

    &--export {
      right: 164px;
    }

    &--share {
      right: 202px;
    }

    &--about {
      right: 240px;
    }
  }
}
</style>
