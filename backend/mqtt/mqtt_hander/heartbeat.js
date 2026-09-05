// 心跳机制已按项目要求停用。
// 保留这些空实现仅用于兼容可能尚未清理的旧调用；它们不会维护在线状态、
// 不会判定设备离线，也不会缓存或补发任何控制指令。

exports.handleHeartbeat = () => {}
exports.storeOfflineMessage = () => {}
exports.handleOfflineMessages = async () => {}
exports.checkOfflineDevices = () => {}
exports.getDeviceStatus = () => undefined
exports.getAllDeviceStatus = () => ({})
exports.setTimeSyncHandler = () => {}
exports.__resetForTests = () => {}
exports.__setNowProviderForTests = () => {}
