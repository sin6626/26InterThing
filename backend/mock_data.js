const db = require('./db/index.js');
const dayjs = require('dayjs');

// 测试时间基准：生成 2026年4月1日前一天（即 2026-03-31）的模拟数据
const targetDate = dayjs('2026-03-31 23:59:59');
const RECORDS_PER_DEVICE = 5000;
const DEVICES = ['1', '2'];

async function generateMockData() {
  console.log(`开始生成测试数据，每5秒一条，单设备 ${RECORDS_PER_DEVICE} 条...`);

  const batchSize = 1000;
  
  for (const d_no of DEVICES) {
    console.log(`>>> 开始生成设备 ${d_no} 的数据...`);
    for (let i = 0; i < RECORDS_PER_DEVICE; i += batchSize) {
      const sensorBatch = [];
      const behaviorBatch = [];
      
      for (let j = 0; j < batchSize && i + j < RECORDS_PER_DEVICE; j++) {
        const recordIndex = i + j;
        // 每5秒一条数据，最新的是2026-03-31 23:59:59，往回倒推
        // 第 (RECORDS_PER_DEVICE - 1) 条是最新的一条
        const secondsToSubtract = (RECORDS_PER_DEVICE - 1 - recordIndex) * 5;
        const timeStr = targetDate.subtract(secondsToSubtract, 'second').format('YYYY-MM-DD HH:mm:ss');
        
        // 模拟自然波动
        // field1 (湿度): 45% ~ 65%
        const field1 = (55 + Math.sin(recordIndex * 0.1) * 10 + (Math.random() * 2 - 1)).toFixed(2);
        // field2 & field4 (温度): 20 ~ 26 °C
        const field2 = (23 + Math.cos(recordIndex * 0.05) * 3 + (Math.random() - 0.5)).toFixed(2);
        const field4 = (23.5 + Math.cos(recordIndex * 0.05) * 2.5 + (Math.random() - 0.5)).toFixed(2);
        // field3 & field5 (浊度): 0.5 ~ 2.5 NTU
        const field3 = (1.5 + Math.sin(recordIndex * 0.2) * 1 + (Math.random() * 0.2)).toFixed(2);
        const field5 = (1.6 + Math.sin(recordIndex * 0.2) * 0.8 + (Math.random() * 0.2)).toFixed(2);
        
        // 最后一条作为“实时数据”
        const onlineStatus = (recordIndex === RECORDS_PER_DEVICE - 1) ? '实时数据' : '保存数据';

        // 传感器数据插入数组 (d_no, field1, field2, field3, field4, field5, c_time, online)
        sensorBatch.push([ d_no, field1, field2, field3, field4, field5, timeStr, onlineStatus ]);
        
        // 行为数据插入数组 (d_no, field1, field2, field3, field4, c_time, online)
        const b_field1 = (22 + Math.cos(recordIndex * 0.05) * 3).toFixed(2);
        const b_field2 = (22.5 + Math.cos(recordIndex * 0.05) * 2).toFixed(2);
        const b_field3 = (1.2 + Math.sin(recordIndex * 0.2) * 1).toFixed(2);
        const b_field4 = (1.3 + Math.sin(recordIndex * 0.2) * 0.8).toFixed(2);
        
        behaviorBatch.push([ d_no, b_field1, b_field2, b_field3, b_field4, timeStr, onlineStatus ]);
      }
      
      // 执行批量插入
      if (sensorBatch.length > 0) {
        const sqlSensor = `INSERT INTO t_sensor_data (d_no, field1, field2, field3, field4, field5, c_time, online) VALUES ?`;
        await new Promise((resolve, reject) => {
          db.query(sqlSensor, [sensorBatch], (err) => {
            if (err) reject(err); else resolve();
          });
        });
      }

      if (behaviorBatch.length > 0) {
        const sqlBehavior = `INSERT INTO t_behavior_data (d_no, field1, field2, field3, field4, c_time, online) VALUES ?`;
        await new Promise((resolve, reject) => {
          db.query(sqlBehavior, [behaviorBatch], (err) => {
            if (err) reject(err); else resolve();
          });
        });
      }
      
      console.log(`设备 ${d_no} 已插入 ${i + Math.min(batchSize, RECORDS_PER_DEVICE - i)} 条...`);
    }
  }
  
  console.log('所有数据生成完毕！');
  process.exit(0);
}

generateMockData().catch(err => {
  console.error('生成数据失败:', err);
  process.exit(1);
});
