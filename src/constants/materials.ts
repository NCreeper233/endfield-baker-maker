// =============================================================================
// 素材集中导入
// -----------------------------------------------------------------------------
// 所有素材在此处一次性导入,组件统一通过 MATERIALS 表引用,避免跨组件重复 import。
// 后续扩展:用户上传自定义头像/表情时,可在此表基础上叠加 custom 字段。
// =============================================================================

import bgApp from '../assets/materials/bg_app.webp'
import headerDeco from '../assets/materials/achievement_main_deco05.webp'
import editPopDecoTl from '../assets/materials/deco_sns_tweet_decorate_31.webp'
import editPopDecoBr from '../assets/materials/deco_sns_tweet_decorate_32.webp'

import cardTexture from '../assets/materials/deco_sns_hudentry_bg.webp'
import cardFaint from '../assets/materials/deco_sns_tweet_decorate_02.webp'
import subFaint from '../assets/materials/deco_sns_tweet_decorate_03.webp'
import decoBadge from '../assets/materials/deco_sns_tweet_decorate_06.webp'
import decoWing from '../assets/materials/deco_sns_tweet_decorate_42.webp'
import subArrow from '../assets/materials/deco_source_arrow.webp'
import underline from '../assets/materials/deco_sns_tweet_decorate.webp'
import cornerDeco from '../assets/materials/deco_sns_list_decorate.webp'
import chatBadge from '../assets/materials/icon_sns_chat_01.webp'
import chatBadgePlayed from '../assets/materials/icon_sns_chat_02.webp'
import circleBorder from '../assets/materials/line_common_circle_food.webp'
import cardArrow from '../assets/materials/deco_common_arrow_p2.webp'

import avatarFrame from '../assets/materials/bg_snscharentry_head_Line.webp'
import avatarBase from '../assets/materials/icon_virtualmouse_bg.webp'

import chatStripV1 from '../assets/materials/chat_strip_v1.webp'
import chatStripV2 from '../assets/materials/chat_strip_v2.webp'
import chatStripV3 from '../assets/materials/chat_strip_v3.webp'
import chatBottomDeco from '../assets/materials/chat_bottom_deco.webp'
import chatEndDeco from '../assets/materials/chat_end_deco.webp'
import choiceTopDeco from '../assets/materials/choice_top_deco.webp'
import chatEmptyPlaceholder from '../assets/materials/chat_empty_placeholder.webp'
import chatCornerDeco45 from '../assets/materials/deco_sns_tweet_decorate_45.webp'
import chatPanelDeco from '../assets/materials/bg_sns_tweet_decorate_21.webp'
import chatPanelDecoAlt from '../assets/materials/bg_sns_tweet_decorate_20.webp'
import chatPanelIcon from '../assets/materials/char_mission_icon_gray.webp'
import chatPanelIconAlt from '../assets/materials/activity_mission_icon_gray.webp'
import chatPanelIconAlt2 from '../assets/materials/fac_mission_icon_gray.webp'
import editModeToggle from '../assets/materials/deco_map_custom_mark_delete_write.webp'
import editModeActive from '../assets/materials/icon_sns_chat_10.webp'
// 编辑模式顶部"下载素材"按钮(icon_attackskillbig_down.webp)
import editBtnDownload from '../assets/materials/icon_attackskillbig_down.webp'

// 编辑模式常驻面板圆形按钮图标(从左到右)
import editBtnTask from '../assets/materials/icon_decorate_task_1.webp'
import editBtnEvents from '../assets/materials/icon_events_overview.webp'
import editBtnWarn from '../assets/materials/icon_btn_lv3_warn.webp'
import editBtnPotential from '../assets/materials/potential_picture.webp'
import editBtnEmoticon from '../assets/materials/icon_sns_chat_emoticon.webp'
import editBtnChat from '../assets/materials/icon_sns_chat_04.webp'
import editBtnChat09 from '../assets/materials/icon_sns_chat_09.webp'
import editBtnCharacter from '../assets/materials/btn_character.webp'
import editBtnDeleteIndeed from '../assets/materials/icon_tips_delete_indeed.webp'
import editBtnUpgrade from '../assets/materials/icon_suffix_upgrade.webp'

// 自定义角色:角色选择面板末尾的"添加"按钮
import iconPlusmark from '../assets/materials/icon_plusmark.webp'

// 编辑模式右侧操作区:删除按钮下方的工具按钮图标(仅样式,无功能)
import editBtnExport from '../assets/materials/icon_contingency_contract_apply_share.webp'
import editBtnShare from '../assets/materials/icon_friend_share.webp'

// 编辑模式:消息气泡旁的删除按钮(42×43)
import deleteMsgBtn from '../assets/materials/icon_btn_cancel.webp'

// 群聊头像(多人对话默认显示)
import groupAvatar from '../assets/materials/icon_sns_npc_channel_a.webp'

/**
 * 内置素材 URL 表。
 *
 * 命名约定:`<区域><用途>` 驼峰,如 `cardTexture`(卡片纹理)、`chatStripV1`(聊天条)。
 * 通过 `MATERIALS.cardTexture` 访问,避免硬编码字符串路径。
 */
export const MATERIALS = {
  // 应用背景
  bgApp,
  // 顶部标题装饰
  headerDeco,
  // 编辑模式弹出面板背景装饰:左上角 / 右下角
  editPopDecoTl,
  editPopDecoBr,
  // 主卡素材
  cardTexture,
  cardFaint,
  underline,
  cornerDeco,
  circleBorder,
  cardArrow,
  // 主卡徽章 / 子卡图标
  chatBadge,
  // 子卡"已播放完"图标(替换默认 chatBadge)
  chatBadgePlayed,
  // 子卡素材
  subFaint,
  decoBadge,
  decoWing,
  subArrow,
  // 聊天区头像框/底
  avatarFrame,
  avatarBase,
  // 聊天区装饰
  // 顶部聊天条(三图点击循环切换,默认 v1)
  chatStripV1,
  chatStripV2,
  chatStripV3,
  chatBottomDeco,
  chatEndDeco,
  // 选项面板顶部装饰
  choiceTopDeco,
  // 起始页(未选中对话)占位图
  chatEmptyPlaceholder,
  // 聊天区右上角装饰(左右镜像)
  chatCornerDeco45,
  // 任务面板矩形右端装饰(bg_sns_tweet_decorate_21.webp)
  chatPanelDeco,
  // 任务面板矩形右端装饰切换(bg_sns_tweet_decorate_20.webp,与 21 互相替换)
  chatPanelDecoAlt,
  // 任务面板矩形左端图标(char_mission_icon_gray.webp)
  chatPanelIcon,
  // 任务面板矩形左端图标切换(activity_mission_icon_gray.webp)
  chatPanelIconAlt,
  // 任务面板矩形左端图标切换(fac_mission_icon_gray.webp)
  chatPanelIconAlt2,
  // 编辑模式切换按钮(播放态)
  editModeToggle,
  // 编辑模式切换按钮(编辑态)
  editModeActive,
  // 编辑模式顶部"下载素材"按钮
  editBtnDownload,
  // 编辑模式常驻面板圆形按钮图标(从左到右)
  editBtnTask,
  editBtnEvents,
  editBtnWarn,
  editBtnPotential,
  editBtnEmoticon,
  editBtnChat,
  // 编辑模式专属按钮图标(编辑切换按钮下方)
  editBtnChat09,
  // 角色名称显示开关按钮(btn_character.png)
  editBtnCharacter,
  // 删除对话按钮图标
  editBtnDeleteIndeed,
  // 自定义页面背景(上传图片)按钮图标
  editBtnUpgrade,
  // 自定义角色:角色选择面板末尾的"添加"按钮(icon_plusmark.png)
  iconPlusmark,
  // 编辑模式右侧工具按钮图标(删除按钮下方,仅样式)
  editBtnExport,
  editBtnShare,
  // 编辑模式:消息气泡旁删除按钮(42×43)
  deleteMsgBtn,
  // 群聊头像(多人对话默认显示)
  groupAvatar,
} as const

/** 素材键名集合(供类型推导用) */
export type MaterialKey = keyof typeof MATERIALS
