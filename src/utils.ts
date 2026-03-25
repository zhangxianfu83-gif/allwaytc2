import { addDays, format } from 'date-fns';
import { Batch, Task } from './types';

/**
 * 将长任务标题缩短为适合日历显示的短标题
 * @param title 原始任务标题
 * @returns 缩短后的标题
 */
export function getShortTitle(title: string): string {
  if (title.includes('母兔饲喂月子餐')) {
    const match = title.match(/(\d+)g/);
    return match ? `${match[1]}g母月` : '母月';
  }
  if (title.includes('公兔饲喂月子餐')) {
    const match = title.match(/(\d+)g/);
    return match ? `${match[1]}g公月` : '公月';
  }
  if (title.includes('配种')) return '配种';
  if (title.includes('加光半天')) return '加光半天';
  if (title.includes('加光')) return '加光';
  if (title.includes('补光')) return '补光';
  if (title.includes('仔兔兔瘟')) return '仔兔免疫';
  if (title.includes('兔瘟普免')) return '兔瘟普免';
  if (title.includes('疫苗')) return '疫苗';
  if (title.includes('小产')) return '小产';
  if (title.includes('大产')) return '大产';
  if (title.includes('催产')) return '催产';
  if (title.includes('摸胎')) return '摸胎';
  if (title.includes('匀崽')) return '匀崽';
  if (title.includes('二次撒窝')) return '二次撒窝';
  if (title.includes('开产箱门') || title.includes('打开产箱门')) return '开门';
  if (title.includes('放产箱')) return '放产箱';
  if (title.includes('补刨花垫草')) return '加垫草';
  if (title.includes('呼吸道预防投药')) return '呼吸道药';
  if (title.includes('分窝')) return '分窝';
  if (title.includes('撤产箱挡板')) return '撤挡板';
  if (title.includes('撤产箱')) return '撤箱';
  if (title.includes('产前消炎')) return '产前消炎';
  if (title.includes('产后消炎')) return '产后消炎';
  if (title.includes('注射氯前列醇钠')) return '氯前列';
  
  return title;
}

/**
 * 为一个繁育批次生成完整的日程任务（基于42天繁育周期）
 * @param batch 批次信息
 * @returns 生成的任务列表
 */
export function generateTasksForBatch(batch: Batch): Task[] {
  const tasks: Task[] = [];
  const mDate = new Date(batch.matingDate);
  
  const addTask = (title: string, daysOffset: number, type: Task['type'], cycle: number) => {
    // 生成唯一ID，包含标题以防止同一天同类型的多个任务冲突
    tasks.push({
      id: `${batch.id}-${type}-${daysOffset}-c${cycle}-${title}`,
      batchId: batch.id,
      batchName: batch.name,
      title,
      date: format(addDays(mDate, daysOffset), 'yyyy-MM-dd'),
      completed: false,
      type,
      cycle,
      daysOffset
    });
  };

  // 生成18个周期（约2年），每个周期42天
  const CYCLES = 18; 

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const cycleOffset = cycle * 42;
    const currentMatingDate = addDays(mDate, cycleOffset);
    const m = currentMatingDate.getMonth();
    const d = currentMatingDate.getDate();
    
    // 每年11月15至次年3月15日之间配种的，需要提前加光半天
    const isWinter = (m === 10 && d >= 15) || m === 11 || m === 0 || m === 1 || (m === 2 && d <= 15);
    if (isWinter) {
      addTask('冬季提前加光半天14-22点（第0天）', cycleOffset - 7, 'light', cycle);
    }

    // 配种前48小时（前2天），单只不带仔母兔注射氯前列醇钠0.5ml
    addTask('注射氯前列醇钠0.5ml (单只不带仔母兔)', cycleOffset - 2, 'medicine', cycle);
    
    // 新增：配种前两天 带仔未怀孕母兔分窝补光
    addTask('带仔未怀孕母兔分窝补光', cycleOffset - 2, 'light', cycle);

    if (cycle === 0) {
      // 首次配种前加光 (前6天到当天)
      for (let i = 6; i >= 1; i--) {
        addTask(`加光催情6-22点（第${7 - i}天）`, cycleOffset - i, 'light', cycle);
        // 加光至配种前一天，公兔饲喂月子餐20g
        addTask('公兔饲喂月子餐20g', cycleOffset - i, 'custom', cycle);
      }
      
      addTask('加光催情6-22点（第7天）', cycleOffset, 'light', cycle);
      
      addTask('配种', cycleOffset + 0, 'mating', cycle);
      
      // 首次配种后加光
      addTask('加光催情6-22点（第8天）', cycleOffset + 1, 'light', cycle);
      addTask('加光催情6-22点（第9天）', cycleOffset + 2, 'light', cycle);
      addTask('加光催情6-17点（第10天）', cycleOffset + 3, 'light', cycle);
      
      // 配种后第12天摸胎
      addTask('摸胎 (孕12天)', cycleOffset + 12, 'check', cycle);
    } else {
      addTask('再次配种 (仔兔12日龄)', cycleOffset + 0, 'mating', cycle);
      
      // 配种后第12天摸胎
      addTask('摸胎 (孕12天)', cycleOffset + 12, 'check', cycle);
      
      // 注意：后续轮次的配种前后加光，已经完美包含在上一轮的“仔兔6-15日龄加光”中
      // (上一轮仔兔12日龄 = 本轮配种日，仔兔6-15日龄 = 配种前6天到配种后3天)
    }
    
    // 产前7天（大产日是31天，31-7=24天）
    addTask('产前消炎 (打头孢喹肟)', cycleOffset + 24, 'medicine', cycle);
    
    // 小产日前4天放产箱 (30-4=26)
    addTask('放产箱 (孕26天)', cycleOffset + 26, 'box', cycle);
    
    // 小产日前3天打开产箱门 (30-3=27)
    addTask('打开产箱门 (孕27天)', cycleOffset + 27, 'box', cycle);
    
    // 小产日前1天补刨花垫草 (30-1=29)
    addTask('补刨花垫草 (孕29天)', cycleOffset + 29, 'box', cycle);
    
    addTask('小产日 (孕30天)', cycleOffset + 30, 'delivery_early', cycle);
    addTask('大产日 (仔兔1日龄)', cycleOffset + 31, 'delivery_main', cycle);
    
    addTask('催产日 (仔兔2日龄)', cycleOffset + 32, 'delivery_induce', cycle);
    // 仔兔2日龄给母兔产后消炎
    addTask('产后消炎 (打头孢喹肟)', cycleOffset + 32, 'medicine', cycle);
    
    // 仔兔2日龄匀崽
    addTask('匀崽 (仔兔2日龄)', cycleOffset + 32, 'box', cycle);
    
    // 仔兔5日龄匀崽 (31 + 5 - 1 = 35)
    addTask('匀崽 (仔兔5日龄)', cycleOffset + 35, 'box', cycle);
    
    // 仔兔10日龄匀崽 (31 + 10 - 1 = 40)
    addTask('匀崽 (仔兔10日龄)', cycleOffset + 40, 'box', cycle);
    
    // 仔兔10日龄二次撒窝
    addTask('二次撒窝 (仔兔10日龄)', cycleOffset + 40, 'box', cycle);
    
    // 仔兔第6天到第15天加光 (大产日是第1天，所以 offset 是 31 + i - 1)
    for (let i = 6; i <= 15; i++) {
      const offset = 31 + (i - 1);
      const lightTime = i === 15 ? '6-17点' : '6-22点';
      addTask(`加光催情${lightTime}（第${i - 5}天）`, cycleOffset + offset, 'light', cycle);
      
      // 加光至配种前一天 (仔兔11日龄是配种前一天，因为12日龄配种)
      if (i <= 11) {
        addTask('公兔饲喂月子餐20g', cycleOffset + offset, 'custom', cycle);
      }
    }

    // 母兔月子餐饲喂计划
    // 小产日(30天)前6天(24天)到后3天(33天/仔兔3日龄): 20g
    // 仔兔4日龄(34天): 25g, 5日龄(35天): 30g, 6日龄(36天): 35g
    // 仔兔7-17日龄(37-47天): 40g
    // 仔兔18-25日龄(48-55天): 60g
    for (let day = 24; day <= 55; day++) {
      let amount = 0;
      if (day >= 24 && day <= 33) amount = 20;
      else if (day === 34) amount = 25;
      else if (day === 35) amount = 30;
      else if (day === 36) amount = 35;
      else if (day >= 37 && day <= 47) amount = 40;
      else if (day >= 48 && day <= 55) amount = 60;

      let context = '';
      if (day < 30) context = `孕${day}天`;
      else if (day === 30) context = `小产日`;
      else context = `仔兔${day - 30}日龄`;

      addTask(`母兔饲喂月子餐${amount}g (${context})`, cycleOffset + day, 'custom', cycle);
    }

    // 产箱操作
    // 仔兔18日龄开产箱门，冬季（12月-次年3月）19日龄开产箱门，高温季节（6-10月）16日龄开产箱门
    const day18Date = addDays(mDate, cycleOffset + 48); // 31 + 18 - 1 = 48
    const month = day18Date.getMonth(); // 0-11 (0=Jan, 11=Dec)
    
    if (month === 11 || month <= 2) {
      // 冬季: 12, 1, 2, 3月 (month 11, 0, 1, 2)
      addTask('匀崽 (开产箱门前1天, 18日龄)', cycleOffset + 48, 'box', cycle);
      addTask('开产箱门 (仔兔19日龄)', cycleOffset + 49, 'box', cycle);
    } else if (month >= 5 && month <= 9) {
      // 高温季节: 6, 7, 8, 9, 10月 (month 5, 6, 7, 8, 9)
      addTask('匀崽 (开产箱门前1天, 15日龄)', cycleOffset + 45, 'box', cycle);
      addTask('开产箱门 (仔兔16日龄)', cycleOffset + 46, 'box', cycle);
    } else {
      // 其他季节: 4, 5, 11月 (month 3, 4, 10)
      addTask('匀崽 (开产箱门前1天, 17日龄)', cycleOffset + 47, 'box', cycle);
      addTask('开产箱门 (仔兔18日龄)', cycleOffset + 48, 'box', cycle);
    }

    // 仔兔23日龄撤产箱挡板 (31 + 23 - 1 = 53)
    addTask('撤产箱挡板 (仔兔23日龄)', cycleOffset + 53, 'box', cycle);

    // 仔兔28日龄撤产箱 (31 + 28 - 1 = 58)
    addTask('撤产箱 (仔兔28日龄)', cycleOffset + 58, 'box', cycle);
    
    // 仔兔30日龄兔瘟免疫 (31 + 30 - 1 = 60)
    addTask('仔兔兔瘟免疫 (30日龄)', cycleOffset + 60, 'vaccine', cycle);

    // 仔兔35日龄分窝 (31 + 35 - 1 = 65)
    addTask('仔兔分窝 (35日龄)', cycleOffset + 65, 'weaning', cycle);

    // 分窝当天及后2天(共3天)进行呼吸道预防投药 (仔兔35-37日龄)
    addTask('呼吸道预防投药 (仔兔35日龄)', cycleOffset + 65, 'medicine', cycle);
    addTask('呼吸道预防投药 (仔兔36日龄)', cycleOffset + 66, 'medicine', cycle);
    addTask('呼吸道预防投药 (仔兔37日龄)', cycleOffset + 67, 'medicine', cycle);
  }

  return tasks;
}

/**
 * 生成母兔疫苗接种计划（兔瘟普免，每84天一次）
 * @param batchId 关联的批次ID
 * @param batchName 关联的批次名称
 * @param startDate 开始日期
 * @returns 生成的任务列表
 */
export function generateVaccineTasks(batchId: string, batchName: string, startDate: string): Task[] {
  const tasks: Task[] = [];
  const baseDate = new Date(startDate);

  // 生成未来20个周期（约4.6年）
  for (let i = 0; i < 20; i++) {
    const daysOffset = i * 84; // 每84天一次
    const taskDate = format(addDays(baseDate, daysOffset), 'yyyy-MM-dd');
    
    tasks.push({
      id: `${batchId}-vaccine-${daysOffset}`,
      batchId,
      batchName,
      title: `兔瘟普免 (第${i + 1}次)`,
      date: taskDate,
      completed: false,
      type: 'vaccine'
    });

    // 在第20个周期添加提醒，以便用户手动新增下一阶段计划
    if (i === 19) {
      tasks.push({
        id: `${batchId}-vaccine-reminder`,
        batchId,
        batchName,
        title: '⚠️ 提醒：母兔疫苗计划即将到期，请手动新增下一阶段计划',
        date: taskDate,
        completed: false,
        type: 'custom'
      });
    }
  }
  return tasks;
}
