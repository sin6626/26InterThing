// const mqtt = require('mqtt');

// const mqttOptions = {
//   // 加个客户端id
//     clientId: 'sensorTest_1234',
//     // 加一个设备id
//     deviceId: 1,
//     host: 'localhost',
//     port: 1883,
//     username: '废别',
//     password: '1234'
// }

// // 先连接mqtt服务端
// const mqttClientTest = mqtt.connect(mqttOptions);


// // 开一个定时器, 每隔三秒发送一个心跳信息
// setInterval(() => {
//     mqttClientTest.publish(`sensors/${mqttOptions.deviceId}/heartbeat`, JSON.stringify({x: 4}), {qos: 0});
// }, 3000)


// // MQTT错误处理
// mqttClientTest.on('error', (error) => {
//     console.error('MQTT连接错误:', error);
// });

// module.exports = mqttClientTest;
