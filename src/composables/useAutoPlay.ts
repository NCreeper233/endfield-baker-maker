// =============================================================================
// 自动播放时序控制
// -----------------------------------------------------------------------------
// 职责:根据 store.playingSub 驱动"加载 → 内容 → 下一条"的定时器序列。
//
// 时序设计(每条消息一个周期):
//   A) 普通消息(other / mine 无 choices):
//      loading 阶段(LOADING_MS):显示 LoadingBubble
//      → advance():playedCount++,LoadingBubble 消失,新消息文本出现
//      → content 阶段(CONTENT_MS):文本停留阅读
//      → 若仍有下一条,回到 loading 阶段;否则 store 自动置 playingSub=null
//
//   B) 玩家选择点(mine + choices):
//      scheduleCycle 预判下一条为选择点时,收集连续的选择点消息为"组"
//      → setPendingChoice({ messages: group })
//      → 不启动定时器,等待玩家点击
//      → submitChoice() 清 pendingChoice + advanceToGroupEnd() 一次推进整组
//      → pendingChoice 变 null 触发 watcher,延迟 CONTENT_MS 后恢复 scheduleCycle
//
// store 只持有纯数据,定时器副作用全部收敛于此,便于组件卸载时统一清理。
// =============================================================================

import { onScopeDispose, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore, choiceGroupEnd } from '../stores/chat'

/** 加载气泡显示时长(ms):用户感知"对方正在输入"的停顿 */
const LOADING_MS = 1000
/**
 * 跨方向切换时的加载气泡时长(ms)
 *
 * 同一人连发多条用 LOADING_MS;换人发言(A 最后一条 → B 第一条)用 LOADING_MS_CROSS,
 * 模拟"换人接话"的更长停顿,避免对方刚说完我方立刻回话的突兀感。
 */
const LOADING_MS_CROSS = 1500
/** 每条消息文本停留时长(ms):阅读节奏,过短一闪而过,过长拖沓 */
const CONTENT_MS = 2000
/**
 * 玩家选择提交后,恢复下一周期前的延迟(ms)
 *
 * submitChoice 后 choice 消息已显示,延迟 CONTENT_MS 让玩家阅读自己的选择,
 * 再进入下一周期(避免下一条 loading 立刻弹出,阅读时间过短)。
 */
const CHOICE_RESUME_MS = 1000
/**
 * 进入对话后首次 loading 前的延迟(ms)
 *
 * 切换对话时 chat-scroll 重挂载会播放 chat-in 入场动画(300ms)。
 * 若立即 setLoading(true) 显示 LoadingBubble,会与入场动画冲突导致首屏动画异常。
 * 故先等 CHAT_IN_MS 让入场动画播完,再开始 loading 序列。
 */
const CHAT_IN_MS = 300

/**
 * 启动自动播放定时器序列
 *
 * 在组件 setup 顶层调用一次即可。监听 store.playingSub:
 * - 变为非 null:启动定时器序列(loading → advance → content → 循环)
 * - 变为 null:清除定时器
 *
 * 监听 store.pendingChoice:
 * - 从非 null 变为 null:玩家已提交选择,延迟 CHOICE_RESUME_MS 后恢复 scheduleCycle
 *
 * 组件卸载时 onScopeDispose 清理最后一次定时器,防止泄漏。
 */
export function useAutoPlay() {
  const chatStore = useChatStore()
  const { playingSub, pendingChoice } = storeToRefs(chatStore)

  /** 当前持有的定时器句柄(loading 阶段或 content 阶段或 choice 恢复延迟) */
  let timer: ReturnType<typeof setTimeout> | null = null

  /** 清除当前定时器 */
  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /**
   * 收集从当前播放位置开始的"玩家选择点组"
   *
   * 组 = 自 playedCount 起连续的所有 mine+choices 消息
   * (整组合并为一个选择面板,玩家一次提交推进整组)。
   *
   * @returns 组内消息数组(无选择点时为空数组)
   */
  function collectChoiceGroup() {
    const sub = chatStore.playingSub
    if (sub === null) return []
    const msgs = chatStore.conversations[sub].messages
    const from = chatStore.playedCounts[sub]
    return msgs.slice(from, choiceGroupEnd(msgs, from))
  }

  /**
   * 执行一个播放周期
   *
   * 先预判下一条消息:
   *   - 若为 mine + choices:收集整组设置为 pendingChoice 暂停,等待玩家选择(不启动定时器)
   *   - 否则:走 loading → advance → content 标准时序
   *
   * 递归调度而非 setInterval,确保每步前检查 playingSub 仍为当前对话,
   * 避免 store 在 content 阶段被 stop 后仍继续推进。
   */
  function scheduleCycle() {
    // 预判下一条:若为玩家选择点,收集整组暂停等待
    const group = collectChoiceGroup()
    if (group.length > 0) {
      // 设置 pendingChoice 组:ChoicePanel 显示,定时器不启动
      chatStore.pendingChoice = { messages: group }
      return
    }

    // loading 阶段开始:显示 LoadingBubble
    chatStore.setLoading(true)

    // 判断是否跨方向切换:上一条已播放消息方向 vs 下一条待播放消息方向
    // 跨方向(A 最后一条 → B 第一条)用更长停顿,模拟"换人接话"
    const played = chatStore.playedMessages
    const lastSide = played.length > 0 ? played[played.length - 1].side : null
    const nextSide = chatStore.loadingSide
    const crossSide = lastSide !== null && nextSide !== null && lastSide !== nextSide
    const loadingMs = crossSide ? LOADING_MS_CROSS : LOADING_MS

    timer = setTimeout(() => {
      // 推进:playedCount++(内部 setLoading=false),若播完 store 自动置 playingSub=null
      chatStore.advance()

      // 检查是否仍在播放(advance 可能使 playingSub 变 null)
      if (chatStore.playingSub === null) {
        timer = null
        return
      }

      // content 阶段:isLoading=false,文字停留阅读,LoadingBubble 隐藏
      timer = setTimeout(() => {
        timer = null
        // 仍处于同一播放则进入下一周期(scheduleCycle 开头会预判选择点)
        if (chatStore.playingSub !== null) scheduleCycle()
      }, CONTENT_MS)
    }, loadingMs)
  }

  // 监听 playingSub:启动 / 停止定时器序列
  // 启动时延迟 CHAT_IN_MS,让 chat-scroll 的 chat-in 入场动画先播完,
  // 避免首条 LoadingBubble 与入场动画叠加导致首屏动画异常。
  watch(
    playingSub,
    sub => {
      clearTimer()
      if (sub !== null) {
        timer = setTimeout(() => {
          // 仍处于同一播放才启动(可能在延迟期间被 stop)
          if (chatStore.playingSub === sub) scheduleCycle()
        }, CHAT_IN_MS)
      }
    },
    { immediate: true },
  )

  // 监听 pendingChoice:玩家提交选择后恢复播放
  // 从非 null → null 表示 submitChoice 已执行(advance 已推进),延迟后恢复下一周期
  watch(
    pendingChoice,
    (cur, prev) => {
      if (prev !== null && cur === null) {
        // 仍在播放且未到末尾才恢复(advance 可能已置 playingSub=null 表示对话结束)
        if (chatStore.playingSub !== null) {
          timer = setTimeout(() => {
            timer = null
            if (chatStore.playingSub !== null) scheduleCycle()
          }, CHOICE_RESUME_MS)
        }
      }
    },
  )

  // 组件卸载时清理,防止定时器在 store 仍存活时残留
  onScopeDispose(clearTimer)
}
