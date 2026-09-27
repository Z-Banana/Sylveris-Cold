// 站点全局配置 —— 所有页面共用这一份，避免出现不一致的信息。
export const site = {
  name: '春林冷知',
  brand: 'Sylveris',
  domain: 'cold.sylveris.top',
  get url() {
    return `https://${this.domain}`;
  },
  tagline: '冷静地知道一点没用的东西。',
  description:
    'Sylveris 春林冷知：一片可以慢慢散步的冷知识林子。每日一条冷知识、废话文学馆、冷笑话、年轮归档与林间投稿。冷静地知道一点没用的东西。',
  keywords: [
    '冷知识',
    '冷笑话',
    '废话文学',
    '每日冷知识',
    '无用知识',
    '趣味知识',
    '知识网站',
    '春林冷知',
    'Sylveris',
  ],
  lang: 'zh-CN',
  author: 'Sylveris',
  icp: '', // 备案号，取得后填入即可出现在页脚
  builtAt: new Date().toISOString(),
};

// 内容类型定义（投稿、审核、列表都按这三类走）
export const kinds = [
  { key: 'fact', label: '冷知', path: 'facts' },
  { key: 'feihua', label: '废话', path: 'feihua' },
  { key: 'joke', label: '冷笑话', path: 'jokes' },
];
