import app from './app'
import common from './common'
import core from './core'
import preview from './preview'
import settings from './settings'
import watermark from './watermark'
import workspace from './workspace'

/** ja 词条：按域拆分，合并为一张扁平表（键=中文原文） */
const messages: Record<string, string> = {
  ...app,
  ...common,
  ...core,
  ...preview,
  ...settings,
  ...watermark,
  ...workspace,
}

export default messages
