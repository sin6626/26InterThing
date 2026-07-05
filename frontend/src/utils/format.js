// 页面里常用的简单时间格式化工具。
// 这里直接复用 Element Plus 自带的 dayjs，避免额外引入一套时间库。
import { dayjs } from 'element-plus'

export const formatTime = (time) => dayjs(time).format('YYYY-MM-DD hh:mm')
