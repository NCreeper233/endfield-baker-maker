// =============================================================================
// 初始卡片集合(应用启动时的默认状态)
// -----------------------------------------------------------------------------
// 空工程:启动不内置任何示例对话,所有数据由用户创建(IndexedDB 持久化)。
// 与逻辑解耦:store 启动时直接引用本常量,不参与任何运行时推导。
//
// ⚠ 别名纪律:store 的 cards 与 DataManagerDialog"清空对话"一律消费
// createInitialCards() 的**新数组**,绝不直接持用 INITIAL_CARDS 引用——
// store 增删是原地 push / splice,若与模块常量别名,建卡/删卡会污染常量,
// 后续"清空对话"会把脏常量当"空工程"还回来。工厂深拷贝保证每份独立。
// =============================================================================

import type { Card } from '../types/chat'

/** 初始卡片集合(空工程;仅作为来源数据,禁止在 store 中原地持有) */
export const INITIAL_CARDS: Card[] = []

/**
 * 生成一份全新的初始卡片副本(深拷贝)
 *
 * store 启动 seed 与"清空对话"重置都应调用本工厂而非直接引用 INITIAL_CARDS:
 * 返回的数组不与常量共享引用,后续 store 原地增删元素不会污染常量。
 */
export function createInitialCards(): Card[] {
  return INITIAL_CARDS.map((card) => structuredClone(card))
}
